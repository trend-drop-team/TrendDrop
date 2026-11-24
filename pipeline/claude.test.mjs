import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateJson,generateJsonWithRetry,toJsonSchema} from './claude.mjs';
function mockApi(context,responses){
 const previous=process.env.ANTHROPIC_API_KEY;process.env.ANTHROPIC_API_KEY='test-key';
 context.after(()=>{if(previous===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=previous;});
 const calls=[];
 context.mock.method(globalThis,'fetch',async(url,options)=>{
  calls.push({url,body:JSON.parse(options.body)});
  const status=responses[calls.length-1];
  return new Response(JSON.stringify(status===200?{stop_reason:'end_turn',content:[{type:'text',text:'{"ok":true}'}],usage:{input_tokens:12,output_tokens:5}}:{error:{message:'failed'}}),{status});
 });return calls;
}
const args=['claude-haiku-5-5','system','input',{type:'OBJECT',properties:{ok:{type:'BOOLEAN'}},required:['ok']}];
test('Claude JSON 결과·토큰 사용량을 반환하고 스키마를 변환한다',async context=>{
 const calls=mockApi(context,[200]);let usage;
 assert.deepEqual(await generateJson(...args,{onUsage:value=>{usage=value;}}),{ok:true});
 assert.equal(calls[0].url,'https://api.anthropic.com/v1/messages');
 assert.equal(calls[0].body.model,'claude-haiku-5-5');
 assert.equal(calls[0].body.system,'system');
 assert.deepEqual(calls[0].body.output_config.format.schema,{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false});
 assert.deepEqual(usage,{input_tokens:12,output_tokens:5});
});
test('입력 스키마를 변경하지 않고 중첩 객체도 닫힌 스키마로 만든다',()=>{
 const input={type:'ARRAY',items:{type:'OBJECT',properties:{name:{type:'STRING'}}}};
 assert.equal(toJsonSchema(input).items.additionalProperties,false);
 assert.equal(input.type,'ARRAY');assert.equal(input.items.additionalProperties,undefined);
});
for(const status of [429,500,503,529])test(`${status}만 한 번 재시도한 뒤 성공`,async context=>{
 const calls=mockApi(context,[status,200]);const waits=[];
 assert.deepEqual(await generateJsonWithRetry(...args,{wait:async ms=>waits.push(ms)}),{ok:true});
 assert.equal(calls.length,2);assert.deepEqual(waits,[5000]);
});
for(const status of [400,401,402,403])test(`${status}는 재시도하지 않는다`,async context=>{
 const calls=mockApi(context,[status,200]);
 await assert.rejects(generateJsonWithRetry(...args,{wait:async()=>{}}),e=>e.status===status);assert.equal(calls.length,1);
});
test('연속 일시 오류도 두 번만 요청한다',async context=>{
 const calls=mockApi(context,[503,503,200]);
 await assert.rejects(generateJsonWithRetry(...args,{wait:async()=>{}}),e=>e.status===503);assert.equal(calls.length,2);
});
test('잘린 응답을 결과로 사용하거나 재시도하지 않는다',async context=>{
 mockApi(context,[200]);let count=0;
 context.mock.method(globalThis,'fetch',async()=>{count++;return new Response(JSON.stringify({stop_reason:'max_tokens',content:[{type:'text',text:'{"ok":true}'}]}),{status:200});});
 await assert.rejects(generateJsonWithRetry(...args,{wait:async()=>{}}),/미완료/);assert.equal(count,1);
});
