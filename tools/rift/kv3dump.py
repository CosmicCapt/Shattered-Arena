import sys,struct,json,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import kv3strings, kv3q
from lz4dec import lz4_block
def a(x,n): return (x+n-1)//n*n
def load(path):
    d=kv3strings.resource_data(open(path,'rb').read())
    h=struct.unpack_from('<I16sIHHIIIIHHIIIIHHI'+'I'*12,d,0)
    (_,_,comp,_,_,nb1,ni1,nd1,strtypes,nobj,narr,usz,csz,nblk,blob,_,_,_,
     u0,c0,u1,c1,nb2,ns2,ni2,nd2,nt2,ncnt,x1,x2)=h
    hdr=struct.calcsize('<I16sIHHIIIIHHIIIIHHI'+'I'*12)
    b1=bytes(lz4_block(d,hdr,hdr+c0)[0])[:u0]
    b2=bytes(lz4_block(d,hdr+c0,hdr+c0+c1)[0])[:u1]
    cb=ncnt*4; bb=cb+nb2; ii=a(bb,4)+ns2*2; ii=a(ii,4); dd=a(ii+ni2*4,8); tt=dd+nd2*8
    L=dict(ai=a(nb1,4)+4,nb1=nb1,c=0,b=cb,i=ii,d=dd,t=tt,a=a(a(nb1,4)+ni1*4,8))
    r,st=kv3q.parse(b1,b2,L,('C','I','C','B','B'))
    return r,st,len(b2)
if __name__=='__main__':
    r,st,n=load(sys.argv[1]); print(json.dumps(r,indent=1))
    print(st,n,file=sys.stderr)
