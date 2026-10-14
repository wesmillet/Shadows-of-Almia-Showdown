import math, numpy as np
class Noise:
    def __init__(self, seed):
        rng = np.random.default_rng(seed)
        p = rng.permutation(256); self.perm = np.concatenate([p, p])
        a = rng.uniform(0, 2*math.pi, 256); self.grad = np.stack([np.cos(a), np.sin(a)], 1)
    def perlin(self, x, y):
        xi = np.floor(x).astype(int) & 255; yi = np.floor(y).astype(int) & 255
        xf = x - np.floor(x); yf = y - np.floor(y)
        f = lambda t: t*t*t*(t*(t*6-15)+10); u = f(xf); v = f(yf)
        def g(ix, iy, dx, dy):
            hh = self.perm[self.perm[ix] + iy] & 255
            return self.grad[hh, 0]*dx + self.grad[hh, 1]*dy
        return (g(xi,yi,xf,yf)*(1-u)+g(xi+1,yi,xf-1,yf)*u)*(1-v) + (g(xi,yi+1,xf,yf-1)*(1-u)+g(xi+1,yi+1,xf-1,yf-1)*u)*v
    def fbm(self, x, y, octaves=4):
        out = 0; amp = 1; fr = 1; norm = 0
        for _ in range(octaves):
            out = out + amp*self.perlin(x*fr, y*fr); norm += amp; amp *= .5; fr *= 2
        return out / norm
