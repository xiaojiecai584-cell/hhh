import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
const P='D:/lindoway/.tmp-data/pkg/fitness_motion_ai_package'
const server=await createServer({configFile:'vite.config.ts',server:{middlewareMode:true},appType:'custom',logLevel:'error'})
const {RepCounter}=await server.ssrLoadModule('/src/core/analysis/repCounter.ts')
const {shapeTemplateFor}=await server.ssrLoadModule('/src/core/analysis/motionTemplates.ts')
const mf=readFileSync(P+'/data/real_experiment/annotations/manifest.jsonl','utf8').trim().split('\n').map(l=>JSON.parse(l))
const read=(rel)=>{const f=join(P,'data/real_experiment',rel.replace('../','')); if(!existsSync(f))return null
  const L=readFileSync(f,'utf8').trim().split(/\r?\n/), h=L[0].split(',').map(x=>x.trim()), i=k=>h.indexOf(k)
  return L.slice(1).map(l=>{const c=l.split(','),v=k=>Number(c[i(k)]);return{t:v('timestamp'),ax:v('ax'),ay:v('ay'),az:v('az'),gx:v('gx'),gy:v('gy'),gz:v('gz')}})}
const list=[]
for(const r of mf){if(r.actionId!==1)continue; const s=read(r.file); if(!s||s.length<32)continue; list.push({id:r.sampleId,s})}
const NAME={1:'坐姿推举'}
console.log('=== 坐姿推举：一次录音被数成 ≥2 次的样本 ===\n')
let n2=0
for(const {id,s} of list){
  const t=shapeTemplateFor(1)
  const c=new RepCounter({signal:'gyro',template:t?.mean,templateAxis:t?.axis})
  const evs=[]
  for(const x of s)c.push(x)
  const tail=c.flush(s[s.length-1].t)
  if(tail)evs.push(tail)
  if(c.repCount<2)continue
  n2++
  const total=(s[s.length-1].t-s[0].t)/1000
  console.log(`${id}  共 ${s.length} 点 / ${total.toFixed(1)}s  数出 ${c.repCount} 次`)
  for(const e of evs){
    const seg=s.filter(x=>x.t>=e.startMs&&x.t<=e.endMs)
    let mx=0,mn=1e9
    for(const x of seg){const w=Math.hypot(x.gx,x.gy,x.gz); mx=Math.max(mx,w); mn=Math.min(mn,w)}
    console.log(`   第${e.index}次  ${(e.startMs-s[0].t)}+${(e.durationMs/1000).toFixed(2)}s  幅度${e.rangeDeg.toFixed(1)}  ω峰值${e.peakOmegaDps.toFixed(0)}  ${e.flags.wristFlip?'腕翻':''}`)
  }
  // 两次之间的最小 ω（停顿深度）
  if(evs.length>=2){
    const gap=s.filter(x=>x.t>evs[0].endMs&&x.t<evs[1].startMs)
    if(gap.length){const ws=gap.map(x=>Math.hypot(x.gx,x.gy,x.gz)); console.log(`   两次之间的间隔 ${((evs[1].startMs-evs[0].endMs)/1000).toFixed(2)}s，其间 ω 最低 ${Math.min(...ws).toFixed(0)} 最高 ${Math.max(...ws).toFixed(0)}°/s`)}
    else console.log(`   两次之间无间隔（紧邻）`)
  }
  console.log()
}
console.log(`共 ${n2} 条${n2===0?'（没有）':''}`)
await server.close()
