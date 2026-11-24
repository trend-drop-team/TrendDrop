/** 가상 데이터만 사용한다. 실제 원문·DB 접근과 순위 저장은 없다. */
import {createHash} from 'node:crypto';
import {generateJson} from '../gemini.mjs';
import {extractNew} from '../trend-ranking.mjs';
const report={
 keyMatchesLocal:process.env.EXPECTED_KEY_SHA256 ? createHash('sha256').update(process.env.GEMINI_API_KEY??'').digest('hex')===process.env.EXPECTED_KEY_SHA256 : null,
 cases:[],
};
const model='gemini-3.5-flash-lite';
try {
 const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
  method:'POST',headers:{'content-type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},
  body:JSON.stringify({contents:[{role:'user',parts:[{text:'Return exactly {"ok":true}'}]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:128}}),signal:AbortSignal.timeout(45000)
 });
 const body=await response.json();report.cases.push({name:'minimal',status:response.status,error:body.error,text:body.candidates?.[0]?.content?.parts?.map(p=>p.text??'').join('')});
}catch(error){report.cases.push({name:'minimal',error:error.message})}
try {
 const result=await generateJson(model,'Return JSON only.','Return exactly {"ok":true}',{type:'OBJECT',properties:{ok:{type:'BOOLEAN'}},required:['ok']});
 report.cases.push({name:'production-transport-small',result});
}catch(error){report.cases.push({name:'production-transport-small',status:error.status,error:error.message})}
try {
 const rows=Array.from({length:10},(_,i)=>({site:'youtube',kind:'title',text:`가상상품${i} 신제품 공개`,textHash:`synthetic-${i}`,meta:{}}));
 const result=await extractNew(rows,new Map(),{model});report.cases.push({name:'production-extract-10',extracted:result.extracted});
}catch(error){report.cases.push({name:'production-extract-10',status:error.status,error:error.message})}
console.log(JSON.stringify(report,null,2));
