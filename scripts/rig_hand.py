"""
Auto-rig the sculpted hand (12683_hand_v1_FINAL.obj) into a skinned GLB.

The source is an unrigged quad mesh of a relaxed right hand with a forearm
stump. This script:

  1. loads it and moves it into the game's hand frame — origin at the wrist,
     fingers down -Z, back of the hand +Y, thumb on -X (right hand), metres;
  2. finds the four fingers by clustering cross-sections, traces each
     finger's centreline, and places MCP / PIP / DIP joints by arc length
     (real phalanx proportions 44 / 31 / 25 %);
  3. finds the thumb lobe and places CMC / MCP / IP joints the same way;
  4. skins every vertex to the nearest bone with a smooth blend across the
     joints (palm and forearm → wrist root);
  5. writes a glTF binary with the skeleton, inverse bind matrices, normals,
     JOINTS_0 / WEIGHTS_0, and per-joint local frames whose -Z axis runs
     down the bone and +Y points to the back of the hand, so the game can
     curl a joint by rotating about its local X and fan it about local Y.

Usage: python3 scripts/rig_hand.py <path/to/12683_hand_v1_FINAL.obj> src/assets/hand_right.glb
"""
import json
import struct
import sys

import numpy as np

src, dst = sys.argv[1], sys.argv[2]

# ---------------------------------------------------------------------------
# 1. Load and canonicalise
# ---------------------------------------------------------------------------
V = []
F = []
for line in open(src):
    if line.startswith('v '):
        p = line.split()
        V.append((float(p[1]), float(p[2]), float(p[3])))
    elif line.startswith('f '):
        idx = [int(t.split('/')[0]) - 1 for t in line.split()[1:]]
        for i in range(1, len(idx) - 1):
            F.append((idx[0], idx[i], idx[i + 1]))
V = np.array(V, dtype=np.float64)
F = np.array(F, dtype=np.int64)

# Model → hand frame: (x, y, z)_model → (y, z, x)_local, wrist at model
# (15, -1.4, 6). Units: ~3.06 model units per cm.
SCALE = 0.01 / 3.06
WRIST_MODEL = np.array([15.0, -1.4, 6.0])
P = np.stack([V[:, 1], V[:, 2], V[:, 0]], axis=1)
WRIST = np.array([WRIST_MODEL[1], WRIST_MODEL[2], WRIST_MODEL[0]])
P = (P - WRIST) * SCALE  # metres, wrist at origin
x, y, z = P[:, 0], P[:, 1], P[:, 2]
print('bbox', P.min(0).round(3), P.max(0).round(3))

# ---------------------------------------------------------------------------
# 2. Fingers: cluster cross-sections for z < zKnuckle
# ---------------------------------------------------------------------------
tip_z = z.min()
# Finger region: from the tips up to where the webbing begins. Scan slices
# from the tips toward the palm until the 4 clusters merge.
def kmeans(pts, k, iters=30, seed=0):
    rng = np.random.default_rng(seed)
    order = np.argsort(pts[:, 0])
    cent = pts[order[np.linspace(0, len(pts) - 1, k).astype(int)]].copy()
    for _ in range(iters):
        d = ((pts[:, None, :] - cent[None, :, :]) ** 2).sum(-1)
        lab = d.argmin(1)
        for j in range(k):
            if (lab == j).any():
                cent[j] = pts[lab == j].mean(0)
    return lab, cent

# Slice thickness 2 mm along z. Fingers are separated along x (the thumb is
# at -x, so the index finger has the most negative x of the four).
step = 0.002
def groups_in(pts):
    """Split a cross-section into connected groups by gaps along x."""
    order = np.argsort(pts[:, 0])
    xs = pts[order, 0]
    cuts = np.where(np.diff(xs) > 0.0025)[0]
    bounds = np.concatenate([[0], cuts + 1, [len(xs)]])
    return [pts[order[bounds[k]:bounds[k + 1]]] for k in range(len(bounds) - 1)]

def slice_at(zc):
    m = (z >= zc - step / 2) & (z < zc + step / 2) & (x > -0.062)
    return P[m][:, :2]

# Pass 1: find the z band where all four fingers are present, and the web.
zs = np.arange(tip_z + step, 0.0, step)
counts = []
for zc in zs:
    pts = slice_at(zc)
    counts.append(len(groups_in(pts)) if len(pts) >= 8 else 0)
counts = np.array(counts)
four = np.where(counts >= 4)[0]
first4, last4 = four[0], four[-1]
web_z = zs[last4] + step
centers = np.zeros((4, 2))
n4 = 0
for k in range(first4, last4 + 1):
    if counts[k] != 4:
        continue
    g = groups_in(slice_at(zs[k]))
    g = sorted(g, key=lambda a: a[:, 0].mean())
    centers += np.array([a.mean(0) for a in g])
    n4 += 1
centers /= n4

# Pass 2: trace the four fingers through the band [tip, web] with 1-D
# k-means on x per slice, seeded from the previous slice (touching fingers
# still split at the density valley between them). A finger enters the
# trace once a cluster appears near its centre and leaves at the web band.
BAND_END = web_z - 0.006
fingers = {i: [] for i in range(4)}
cur = centers[:, 0].copy()
for k in range(0, len(zs)):
    if zs[k] > BAND_END:
        break
    pts = slice_at(zs[k])
    if len(pts) < 8:
        continue
    xs = pts[:, 0]
    # Which fingers are present: any point within 8 mm of the finger's current centre.
    present = [fi for fi in range(4) if (np.abs(xs - cur[fi]) < 0.008).any()]
    if not present:
        continue
    cent = cur[present].copy()
    for _ in range(12):
        lab = np.argmin(np.abs(xs[:, None] - cent[None, :]), axis=1)
        for ci in range(len(present)):
            if (lab == ci).any():
                cent[ci] = xs[lab == ci].mean()
    for ci, fi in enumerate(present):
        sel = pts[lab == ci]
        if len(sel) < 4:
            continue
        # Reject a cluster that swallowed a neighbour (far wider than a finger).
        if sel[:, 0].max() - sel[:, 0].min() > 0.034:
            continue
        cur[fi] = cent[ci]
        fingers[fi].append((zs[k], sel[:, 0].mean(), sel[:, 1].mean(), sel[:, 0].max() - sel[:, 0].min()))
print('finger centres x =', centers[:, 0].round(3), 'band end z =', round(BAND_END, 4))

def smooth(a, k=5):
    out = a.copy()
    for i in range(len(a)):
        lo, hi = max(0, i - k), min(len(a), i + k + 1)
        out[i] = a[lo:hi].mean(0)
    return out

# Knuckle (MCP) row: an anatomical arc proximal of the web — the middle
# knuckle furthest out, the pinky furthest back.
MCP_Z = [web_z + 0.014, web_z + 0.010, web_z + 0.016, web_z + 0.026]
joints = {}
for fi in range(4):
    arr = np.array(fingers[fi])
    arr = arr[np.argsort(arr[:, 0])]  # by z ascending (tip first)
    cl = smooth(arr[:, [1, 2, 0]])  # (x, y, z) centreline, tip → web
    tip = cl[0].copy()
    tip[2] = arr[0, 0] - 0.004
    # MCP: continue the finger's proximal direction back to the knuckle row.
    axis = cl[-1] - cl[max(0, len(cl) - 12)]
    axis /= np.linalg.norm(axis)
    dz = MCP_Z[fi] - cl[-1][2]
    mcp = cl[-1] + axis * (dz / max(axis[2], 0.5))
    mcp[1] += 0.004  # the knuckle sits toward the back of the hand
    cl_full = np.vstack([cl, mcp[None, :]])[::-1]  # MCP → tip
    seg = np.linalg.norm(np.diff(cl_full, axis=0), axis=1)
    L = seg.sum()
    cum = np.concatenate([[0], np.cumsum(seg)])
    def at(frac):
        sarc = frac * L
        i = np.searchsorted(cum, sarc)
        i = min(max(i, 1), len(cum) - 1)
        t = (sarc - cum[i - 1]) / max(seg[i - 1], 1e-9)
        return cl_full[i - 1] + (cl_full[i] - cl_full[i - 1]) * t
    pip = at(0.45)
    dip = at(0.76)
    joints[f'f{fi}'] = {'mcp': mcp, 'pip': pip, 'dip': dip, 'tip': tip, 'length': L}
    print(f'finger {fi}: n={len(arr)} mcp={mcp.round(3)} pip={pip.round(3)} dip={dip.round(3)} tip={tip.round(3)} L={L:.3f}')

# ---------------------------------------------------------------------------
# 3. Thumb: lobe at x < -0.045 (model y < -14), trace along its own axis
# ---------------------------------------------------------------------------
# The thumb lobe hangs below the index finger on -x; separate it from the
# index by requiring it to be well outside the four-finger band.
tm = (x < centers[0, 0] - 0.014) & (z > -0.175)
T = P[tm]
# Thumb tip: the extreme point along the thumb's pointing direction.
dirn = np.array([-0.55, -0.25, -0.80])
dirn /= np.linalg.norm(dirn)
ttip = T[np.argmax(T @ dirn)]
# CMC: base of the thumb metacarpal, inside the palm near the wrist.
cmc = np.array([-0.026, -0.006, -0.028])
axis = ttip - cmc
L = np.linalg.norm(axis)
u = axis / L
proj = (T - cmc) @ u
cl = []
for sarc in np.arange(0.012, L - 0.003, 0.003):
    m = np.abs(proj - sarc) < 0.0015
    if m.sum() > 5:
        cl.append(T[m].mean(0))
cl = smooth(np.array(cl), 3)
cl = np.vstack([cmc[None, :], cl, ttip[None, :]])
seg = np.linalg.norm(np.diff(cl, axis=0), axis=1)
cum = np.concatenate([[0], np.cumsum(seg)])
Lc = cum[-1]
def tat(frac):
    sarc = frac * Lc
    i = np.searchsorted(cum, sarc)
    i = min(max(i, 1), len(cum) - 1)
    t = (sarc - cum[i - 1]) / max(seg[i - 1], 1e-9)
    return cl[i - 1] + (cl[i] - cl[i - 1]) * t
tmcp = tat(0.42)
tip_j = tat(0.72)
joints['thumb'] = {'cmc': cmc, 'mcp': tmcp, 'ip': tip_j, 'tip': ttip}
print('thumb: cmc', cmc.round(3), 'mcp', tmcp.round(3), 'ip', tip_j.round(3), 'tip', ttip.round(3))

# ---------------------------------------------------------------------------
# 4. Skeleton
# ---------------------------------------------------------------------------
# name, parent, head, tail
bones = [('wrist', None, np.zeros(3), np.array([0, 0, -0.08]))]
FN = ['index', 'middle', 'ring', 'pinky']
for fi in range(4):
    j = joints[f'f{fi}']
    n = FN[fi]
    bones.append((f'{n}_1', 'wrist', j['mcp'], j['pip']))
    bones.append((f'{n}_2', f'{n}_1', j['pip'], j['dip']))
    bones.append((f'{n}_3', f'{n}_2', j['dip'], j['tip']))
jt = joints['thumb']
bones.append(('thumb_1', 'wrist', jt['cmc'], jt['mcp']))
bones.append(('thumb_2', 'thumb_1', jt['mcp'], jt['ip']))
bones.append(('thumb_3', 'thumb_2', jt['ip'], jt['tip']))
names = [b[0] for b in bones]
index = {n: i for i, n in enumerate(names)}

# World rotation per bone: -Z down the bone, +Y toward the back of the hand.
def frame(head, tail, up_hint):
    zax = -(tail - head)
    zax /= np.linalg.norm(zax)
    yax = up_hint - zax * (up_hint @ zax)
    yax /= np.linalg.norm(yax)
    xax = np.cross(yax, zax)
    return np.stack([xax, yax, zax], axis=1)  # columns

world_R = []
world_T = []
for name, parent, head, tail in bones:
    if name == 'wrist':
        R = np.eye(3)
    elif name.startswith('thumb'):
        # The thumb's "back" points away from the palm-ish: toward +Y rotated
        # outward; use the direction from the finger side toward the thumb.
        R = frame(head, tail, np.array([-0.55, 0.85, 0.0]))
    else:
        R = frame(head, tail, np.array([0.0, 1.0, 0.0]))
    world_R.append(R)
    world_T.append(head)

def quat_from_mat(R):
    m = R
    t = np.trace(m)
    if t > 0:
        s = np.sqrt(t + 1.0) * 2
        w = 0.25 * s
        xq = (m[2, 1] - m[1, 2]) / s
        yq = (m[0, 2] - m[2, 0]) / s
        zq = (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        w = (m[2, 1] - m[1, 2]) / s
        xq = 0.25 * s
        yq = (m[0, 1] + m[1, 0]) / s
        zq = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        w = (m[0, 2] - m[2, 0]) / s
        xq = (m[0, 1] + m[1, 0]) / s
        yq = 0.25 * s
        zq = (m[1, 2] + m[2, 1]) / s
    else:
        s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        w = (m[1, 0] - m[0, 1]) / s
        xq = (m[0, 2] + m[2, 0]) / s
        yq = (m[1, 2] + m[2, 1]) / s
        zq = 0.25 * s
    q = np.array([xq, yq, zq, w])
    return q / np.linalg.norm(q)

local_nodes = []
for i, (name, parent, head, tail) in enumerate(bones):
    if parent is None:
        Rl = world_R[i]
        Tl = world_T[i]
    else:
        pi = index[parent]
        Rp = world_R[pi]
        Rl = Rp.T @ world_R[i]
        Tl = Rp.T @ (world_T[i] - world_T[pi])
    local_nodes.append((name, parent, Tl, quat_from_mat(Rl)))

# ---------------------------------------------------------------------------
# 5. Skin weights
# ---------------------------------------------------------------------------
heads = np.array([b[2] for b in bones])
tails = np.array([b[3] for b in bones])
NB = len(bones)
# Distance from every vertex to every bone segment, and the projection param.
d = np.zeros((len(P), NB))
tpar = np.zeros((len(P), NB))
for b in range(NB):
    a = heads[b]
    ab = tails[b] - a
    L2 = ab @ ab
    t = np.clip(((P - a) @ ab) / max(L2, 1e-12), 0, 1)
    tpar[:, b] = t
    d[:, b] = np.linalg.norm(P - (a + t[:, None] * ab[None, :]), axis=1)
# The wrist bone owns the palm and the forearm: its "distance" is the
# distance to a flat palm patch (x in [-0.036, 0.048], z in [-0.088, 0.05])
# rather than to a line, so palm-edge vertices never follow a finger.
px = np.clip(x, -0.036, 0.048)
pz = np.clip(z, -0.088, 0.05)
d[:, 0] = np.sqrt((x - px) ** 2 + (z - pz) ** 2 + np.maximum(np.abs(y) - 0.012, 0) ** 2)
# Thumb bones only compete inside the thumb lobe / thenar.
thumb_ids = [index['thumb_1'], index['thumb_2'], index['thumb_3']]
not_thumb = ~((x < -0.034) & (z > -0.15))
for b in thumb_ids:
    d[not_thumb, b] += 1.0
# The thumb metacarpal (thumb_1) is inside the palm: vertices near it on the
# palm surface should follow it only partially.
primary = d.argmin(1)
w = np.zeros((len(P), 4), dtype=np.float32)
j = np.zeros((len(P), 4), dtype=np.uint8)
parent_of = [index[b[1]] if b[1] else -1 for b in bones]
BLEND = 0.010  # metres of blend across each joint
for vi in range(len(P)):
    b = primary[vi]
    t = tpar[vi, b]
    pb = parent_of[b]
    # Near the head of the bone: blend with the parent.
    a_len = np.linalg.norm(tails[b] - heads[b])
    s_along = t * a_len
    wb = 1.0
    other = -1
    if pb >= 0 and s_along < BLEND:
        k = 0.5 + 0.5 * (s_along / BLEND)  # 0.5 at the joint → 1 past the blend zone
        wb = k
        other = pb
    if b == 0:
        wb, other = 1.0, -1
    j[vi, 0] = b
    w[vi, 0] = wb
    if other >= 0:
        j[vi, 1] = other
        w[vi, 1] = 1.0 - wb
w /= w.sum(1, keepdims=True)

# ---------------------------------------------------------------------------
# 6. Normals (area weighted, smooth)
# ---------------------------------------------------------------------------
N = np.zeros_like(P)
tri = P[F]
fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
for k in range(3):
    np.add.at(N, F[:, k], fn)
N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
# Winding sanity: normals should point outward; check the mean dot with
# the vector from the centroid.
c = P.mean(0)
outward = ((P - c) * N).sum(1).mean()
if outward < 0:
    F = F[:, [0, 2, 1]]
    N = -N
print('outward check', outward)

# ---------------------------------------------------------------------------
# 7. Write GLB
# ---------------------------------------------------------------------------
def pad4(b, fill=b'\x00'):
    return b + fill * ((4 - len(b) % 4) % 4)

pos = P.astype(np.float32)
idx = F.astype(np.uint16).reshape(-1)  # < 65536 vertices
w16 = np.round(w * 65535).astype(np.uint16)
pm = (np.abs(x) < 0.02) & (z > -0.07) & (z < -0.03)
print('palm thickness y: [%.3f, %.3f]' % (y[pm].min(), y[pm].max()))
# inverse bind matrices (column-major 4x4)
ibm = []
for i in range(NB):
    M = np.eye(4)
    M[:3, :3] = world_R[i]
    M[:3, 3] = world_T[i]
    Mi = np.linalg.inv(M)
    ibm.append(Mi.T.reshape(-1))  # column-major
ibm = np.array(ibm, dtype=np.float32).reshape(-1)

buffers = []
views = []
accessors = []
def add(arr, target=None):
    b = pad4(arr.tobytes())
    off = sum(len(x) for x in buffers)
    buffers.append(b)
    views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(arr.tobytes()), **({'target': target} if target else {})})
    return len(views) - 1

vi_pos = add(pos, 34962)
vi_j = add(j, 34962)
vi_w = add(w16, 34962)
vi_idx = add(idx, 34963)
vi_ibm = add(ibm)

accessors.append({'bufferView': vi_pos, 'componentType': 5126, 'count': len(pos), 'type': 'VEC3',
                  'min': pos.min(0).tolist(), 'max': pos.max(0).tolist()})
accessors.append({'bufferView': vi_j, 'componentType': 5121, 'count': len(j), 'type': 'VEC4'})
accessors.append({'bufferView': vi_w, 'componentType': 5123, 'normalized': True, 'count': len(w16), 'type': 'VEC4'})
accessors.append({'bufferView': vi_idx, 'componentType': 5123, 'count': len(idx), 'type': 'SCALAR'})
accessors.append({'bufferView': vi_ibm, 'componentType': 5126, 'count': NB, 'type': 'MAT4'})

# Nodes: 0 = mesh node, 1.. = joints in bone order.
nodes = [{'name': 'hand_mesh', 'mesh': 0, 'skin': 0}]
for name, parent, Tl, q in local_nodes:
    nodes.append({'name': name, 'translation': Tl.tolist(), 'rotation': q.tolist()})
for i, (name, parent, Tl, q) in enumerate(local_nodes):
    if parent is not None:
        nodes[1 + index[parent]].setdefault('children', []).append(1 + i)

gltf = {
    'asset': {'version': '2.0', 'generator': 'home-court rig_hand.py'},
    'scene': 0,
    'scenes': [{'nodes': [0, 1]}],
    'nodes': nodes,
    'meshes': [{'name': 'hand', 'primitives': [{
        'attributes': {'POSITION': 0, 'JOINTS_0': 1, 'WEIGHTS_0': 2},
        'indices': 3, 'material': 0}]}],
    'materials': [{'name': 'skin', 'pbrMetallicRoughness': {'baseColorFactor': [0.79, 0.56, 0.41, 1], 'metallicFactor': 0, 'roughnessFactor': 0.62}}],
    'skins': [{'name': 'hand_rig', 'inverseBindMatrices': 4, 'skeleton': 1, 'joints': [1 + i for i in range(NB)]}],
    'accessors': accessors,
    'bufferViews': views,
    'buffers': [{'byteLength': sum(len(b) for b in buffers)}],
    'extras': {'boneNames': names, 'joints': {k: {kk: (vv.tolist() if hasattr(vv, 'tolist') else vv) for kk, vv in v.items()} for k, v in joints.items()}},
}
jsonb = pad4(json.dumps(gltf, separators=(',', ':')).encode(), b' ')
binb = b''.join(buffers)
glb = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(jsonb) + 8 + len(binb))
glb += struct.pack('<II', len(jsonb), 0x4E4F534A) + jsonb
glb += struct.pack('<II', len(binb), 0x004E4942) + binb
open(dst, 'wb').write(glb)
print('wrote', dst, len(glb), 'bytes;', len(pos), 'verts', len(F), 'tris', NB, 'bones')
