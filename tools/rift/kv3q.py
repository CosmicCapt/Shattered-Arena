class Flagged(str):
    def __new__(c,v,f):
        o=str.__new__(c,v); o.flag=f; return o
import struct
def parse(b1,b2,L,var):
    strs=b1[:L['nb1']].split(b'\0')
    st={'ai':L.get('ai',0),'c':L['c'],'i':L['i'],'b':L['b'],'d':L['d'],'t':L['t'],'a':L['a']}
    def rd(k,fmt,n): v=struct.unpack_from(fmt,b1 if k in ('a','ai') else b2,st[k])[0]; st[k]+=n; return v
    src={'C':lambda: rd('c','<i',4),'I':lambda: rd('i','<i',4),'B':lambda: rd('b','<B',1)}
    def T():
        t=b2[st['t']]; st['t']+=1; st['flag']=0
        if t&0x80: t&=0x7f; st['flag']=b2[st['t']]; st['t']+=1
        return t
    S=lambda i: '' if i<0 else strs[i].decode()
    def val(t,d=0):
        if d>40: raise ValueError('deep')
        if t==9:
            n=src[var[0]](); o={}
            for _ in range(n): k=S(src['I']()); o[k]=val(T(),d+1)
            return o
        if t==8: return [val(T(),d+1) for _ in range(src[var[1]]())]
        if t==10: n=src[var[2]](); s=T(); return [val(s,d+1) for _ in range(n)]
        if t==24: n=src[var[3]](); s=T(); return [val(s,d+1) for _ in range(n)]
        if t==25:
            n=src[var[4]](); s=T(); out=[]
            for _ in range(n):
                if s==5: out.append(rd('a','<d',8))
                elif s in (11,12): out.append(rd('ai','<i',4))
                elif s==19: out.append(struct.unpack('<f',struct.pack('<i',rd('ai','<i',4)))[0])
                else: out.append(val(s,d+1))
            return out
        if t==6:
            f=st.get('flag',0); v=S(src['I']())
            return Flagged(v,f) if f else v
        if t in (11,12): return src['I']()
        if t==19: return struct.unpack('<f',struct.pack('<i',src['I']()))[0]
        if t in (3,4): return rd('d','<q',8)
        if t==5: return rd('d','<d',8)
        if t in (15,16): return t-15
        if t in (17,18): return float(t-17)
        if t in (13,14): return t==13
        if t==1: return None
        if t in (2,23): return src['B']()
        raise ValueError('type %d'%t)
    r=val(T()); return r,st
