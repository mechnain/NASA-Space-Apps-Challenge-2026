import urllib.request, urllib.parse, json, os, sys, time, hashlib
API="https://ssd.jpl.nasa.gov/api/horizons.api"
DATA=os.path.join(os.path.dirname(__file__),"..","data","horizons")
os.makedirs(DATA,exist_ok=True)
def url(body,lon,lat,alt,start,stop,step):
    p={"format":"json","COMMAND":f"'{body}'","CENTER":"'coord@301'","COORD_TYPE":"'GEODETIC'",
       "SITE_COORD":f"'{lon},{lat},{alt}'","MAKE_EPHEM":"'YES'","EPHEM_TYPE":"'OBSERVER'",
       "START_TIME":f"'{start}'","STOP_TIME":f"'{stop}'","STEP_SIZE":f"'{step}'",
       "QUANTITIES":"'4'","CSV_FORMAT":"'YES'","ANG_FORMAT":"'DEG'","EXTRA_PREC":"'YES'"}
    return API+"?"+urllib.parse.urlencode(p)
def query(body,lon,lat,alt,start,stop,step):
    u=url(body,lon,lat,alt,start,stop,step)
    fn=os.path.join(DATA,hashlib.md5(u.encode()).hexdigest()[:12]+f"_{body}_{lat}_{start[:10]}_{step.replace(' ','')}.txt")
    if os.path.exists(fn): txt=open(fn).read()
    else:
        for k in range(4):
            try:
                txt=json.load(urllib.request.urlopen(u,timeout=120))["result"]; break
            except Exception as e:
                print("retry",e,file=sys.stderr); time.sleep(3)
        open(fn,"w").write(txt); time.sleep(0.3)
    if "$$SOE" not in txt: raise RuntimeError(txt[-800:])
    rows=[]
    for ln in txt.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines():
        f=[x.strip() for x in ln.split(",")]
        rows.append((f[0],float(f[3]),float(f[4])))
    return rows,u
