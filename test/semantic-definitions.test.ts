import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculate,fraction,percentile,scaled,type Data} from '../scripts/semantics/oracle.js';
test('exact references reject precision loss and distinguish percentile definitions',()=>{
  assert.equal(scaled('-1.25',2),-125n);assert.throws(()=>scaled('1.251',2));
  assert.equal(fraction(1n,3n)?.decimal10,'0.3333333333');assert.equal(fraction(1n,0n),null);
  assert.equal(percentile([100000n,200000n,300000n,400000n],true)?.decimal10,'32.5000000000');
  assert.equal(percentile([100000n,200000n,300000n,400000n],false)?.decimal10,'30.0000000000');
  assert.equal(percentile([],true),null);
  assert.equal(percentile([70000n],true)?.decimal10,'7.0000000000');
  assert.equal(percentile([40000n,40000n,80000n],true)?.decimal10,'6.0000000000');
});
export const fixture: Data={customers:[{customer_id:'a',city:'México D.F.',country:'X'},{customer_id:'b',city:null,country:null}],employees:[{employee_id:1},{employee_id:2}],
  orders:[{order_id:1,order_date:'2026-01-02',customer_id:'a',employee_id:1,shipped_date:null,freight:'10'},
    {order_id:2,order_date:'2026-01-02',customer_id:'a',employee_id:1,shipped_date:'2026-01-03',freight:null},
    {order_id:3,order_date:null,customer_id:null,employee_id:null,shipped_date:null,freight:'0'}],
  details:[{order_id:1,unit_price:'100',quantity:1,discount:'0.10'},{order_id:1,unit_price:'100',quantity:1,discount:'0.10'}]};
test('fixtures distinguish population, ties, accent, absent joins and ratio grain',()=>{
  const r=calculate(fixture,1), money=r.money['net/allOrders'] as any;
  assert.deepEqual(r.recent.exactN,[2]);assert.deepEqual(r.recent.includeCutoffTies,[2,1]);assert.deepEqual(r.recent.byIdContrast,[3]);
  assert.equal(calculate(fixture,0).recent.includeCutoffTies.length,0);
  assert.equal(r.average.allOrders?.numerator,'2');assert.equal(r.average.allOrders?.denominator,'3');assert.equal(r.average.withDetails?.decimal10,'2.0000000000');
  const mexico=r.cities.find(c=>c.city==='mexico d.f.')!;assert.equal(mexico.caseInsensitive,0);assert.equal(mexico.latinAccentFold,1);
  assert.deepEqual(r.employees.all[1],{employee_id:2,orders:0,shipped:0,unshipped:0});assert.deepEqual(r.employees.unassignedOrderIds,[3]);
  assert.equal(money.ratios[0].freight.decimal10,'10.0000000000'); // Two lines must not double freight.
  assert.equal(money.ratios[0].ratio.decimal10,'0.0555555556');assert.equal(money.ratios[1].ratio,null);
  assert.equal(money.ratios[0].ratioUnknownIfAnyNullFreight,null);assert.equal(money.unmatchedCustomerOrders,1);
  assert.equal(money.countries[0].continuous.decimal10,'135.0000000000');assert.equal(money.countries[0].discrete.decimal10,'180.0000000000');
  const different=structuredClone(fixture);different.details.push({order_id:2,unit_price:'20',quantity:1,discount:'0'});
  const ratios=(calculate(different).money['net/allOrders'] as any).ratios[0];assert.notEqual(ratios.ratio.decimal10,ratios.meanOrderRatio.decimal10);
  const empty=calculate({customers:[],orders:[],employees:[],details:[]});assert.equal(empty.average.allOrders,null);
});
test('NULL country is a group, while unmatched customers are excluded; trimming is explicit',()=>{
  const input=structuredClone(fixture);
  input.orders[2].customer_id='b';
  input.customers[1].city=' London ';
  const r=calculate(input), money=r.money['net/allOrders'] as any;
  assert.equal(money.unmatchedCustomerOrders,0);
  assert.equal(money.countries.find((c:any)=>c.country===null).continuous.decimal10,'0.0000000000');
  const city=r.cities.find(c=>c.city==='London')!;
  assert.equal(city.caseInsensitive,0);assert.equal(city.trimAndCaseInsensitive,1);
});

test('compact evidence retains each variant fingerprint and exact named contrasts without full populations', async()=>{
  const {compactResults,resultHash}=await import('../scripts/semantics/artifact.js');
  const full=calculate(fixture);
  const branch=full.money['net/allOrders'] as any;
  branch.ratios[0].customer_id='ALFKI';branch.countries[0].country='Germany';
  const compact=compactResults(full);
  const summary=compact.money['net/allOrders'];
  assert.equal(summary.fullBranchSha256,resultHash(branch));
  assert.deepEqual(summary.representativeRatios,[branch.ratios[0]]);
  assert.deepEqual(summary.representativeCountries,[branch.countries[0]]);
  assert.deepEqual(summary.customerIdsWithoutOrders,['b']);
  assert.equal(summary.customerCount,2);
  assert.equal('ratios' in summary,false);
  assert.equal(Object.keys(compact.money).length,6);
  assert.equal((full.money['net/allOrders'] as any).ratios.length,2);
});
