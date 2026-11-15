import numpy as np, os
R=1737400.0
D=os.path.join(os.path.dirname(__file__),"..","data","dem","LDEM_75S_240M.IMG")
N=3812; SC=240.0; OFF=1905.5
dem=np.fromfile(D,dtype='<i2').reshape(N,N).astype(np.float32)*0.5  # height m above 1737.4 km sphere
def ll2px(lat,lon,ysign):
    lat=np.radians(lat); lon=np.radians(lon)
    r=2*R*np.tan(np.pi/4+lat/2)
    x=r*np.sin(lon); y=r*np.cos(lon)
    s=x/SC+OFF-1; l=ysign*y/SC+OFF-1   # 0-based
    return l,s
YS=+1
def height(lat,lon):
    l,s=ll2px(lat,lon,YS)
    l0=np.clip(np.floor(l).astype(int),0,N-2); s0=np.clip(np.floor(s).astype(int),0,N-2)
    fl=l-l0; fs=s-s0
    return (dem[l0,s0]*(1-fl)*(1-fs)+dem[l0+1,s0]*fl*(1-fs)+dem[l0,s0+1]*(1-fl)*fs+dem[l0+1,s0+1]*fl*fs)
def horizon(lat,lon,obs_h=2.0,maxd=250e3,naz=360):
    az=np.radians(np.arange(naz)*360/naz)[:,None]
    d=np.concatenate([np.arange(240,20e3,120),np.arange(20e3,maxd,240)])[None,:]
    g=d/R; p1=np.radians(lat); l1=np.radians(lon)
    p2=np.arcsin(np.sin(p1)*np.cos(g)+np.cos(p1)*np.sin(g)*np.cos(az))
    l2=l1+np.arctan2(np.sin(az)*np.sin(g)*np.cos(p1),np.cos(g)-np.sin(p1)*np.sin(p2))
    p2d=np.degrees(p2); ok=p2d<-75.2
    Rt=R+height(p2d,np.degrees(l2)); Ro=R+height(np.array(lat),np.array(lon))+obs_h
    el=np.degrees(np.arctan2(Rt*np.cos(g)-Ro,Rt*np.sin(g)))
    el[~ok]=-90
    return np.degrees(az[:,0]), el.max(1), float(Ro-R-obs_h)
