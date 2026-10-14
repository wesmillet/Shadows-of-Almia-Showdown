"""Semantic labels for the demo room's land layer and the path layer."""
import numpy as np, sunny
TSD=sunny.TS['tilesets']['tileset_sunnysideworld']['autotiles']
LAND_SET=set(TSD['Land']['tiles'])-{0}
RIVER_SET=set(TSD['River']['tiles'])-{0}
P1=set(TSD['Path 01']['tiles'])-{0}; P2=set(TSD['Path 02']['tiles'])-{0}; P3=set(TSD['Path 03']['tiles'])-{0}
G={66,129,130,131,132,133,134,193} | LAND_SET
S={69,71,72,73,339,340,341,342,343,344}
SG={326,327,328,329}                 # grass/sand diagonals
F={101,202,203,204,266,267,268,418,394,396,330,332,147,149,150,152}
W={0,264,148,151,211,212,213,214,215,216,403,405,406,408,478,479,480,481,1163,1164,1165,1166,1227,1228,1229,1230,1291,1292,1293,1294,1355,1356,1357,1358}
R=RIVER_SET|{542,543,544,545,859,414,415,416,417,410,411,412,413}
M={270,271,272,273}
D=set(range(1795,2200))
def land_label(t):
    if t == 264 or t == 0: return 'W'
    if t in G and t not in RIVER_SET: return 'G'
    if t in S: return 'S'
    if t in SG: return 'G'
    if t in F: return 'F'
    if t in R: return 'R'
    if t in M: return 'M'
    if t in D: return 'D'
    if t in W: return 'W'
    return '?'
def demo_land_labels():
    L=sunny.layers(); land=L['land']
    lab=np.array([[land_label(t) for t in row] for row in land['tiles']])
    return lab
P1F={449,457,458,459,521,522}; P2F={460,468,469,532,533}; P3F={482,490,491,554,555}
def path_label(t):
    if t in P1 or t in P1F: return '1'
    if t in P2 or t in P2F: return '2'
    if t in P3 or t in P3F: return '3'
    return '.'
def demo_path_labels():
    L=sunny.layers(); p=L['paths']
    return np.array([[path_label(t) for t in row] for row in p['tiles']])
