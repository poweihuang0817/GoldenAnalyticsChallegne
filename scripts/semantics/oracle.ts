/** Independent raw-row reference calculations; never used to execute application queries. */
export type Row = Record<string, any>;
export interface Data { customers: Row[]; orders: Row[]; details: Row[]; employees: Row[] }
export type Fraction = { numerator: string; denominator: string; decimal10: string };
const gcd = (a: bigint,b: bigint): bigint => b ? gcd(b,a%b) : a < 0n ? -a : a;
export function fraction(n: bigint,d: bigint): Fraction | null {
  if(!d)return null;
  if(d<0n){n=-n;d=-d;}
  const g=gcd(n,d); n/=g;d/=g;
  const negative=n<0n, magnitude=negative?-n:n;
  const rounded=(magnitude*10n**10n+d/2n)/d;
  return {numerator:String(n),denominator:String(d),decimal10:`${negative&&rounded!==0n?'-':''}${rounded/10n**10n}.${String(rounded%10n**10n).padStart(10,'0')}`};
}
export function scaled(value: unknown,places: number): bigint {
  const text=String(value), match=/^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if(!match || /[1-9]/.test((match[3]??'').slice(places)))throw new Error(`Not exact at scale ${places}: ${text}`);
  return (match[1]?-1n:1n)*(BigInt(match[2])*10n**BigInt(places)+BigInt((match[3]??'').slice(0,places).padEnd(places,'0')));
}
const sum=(values: bigint[])=>values.reduce((a,b)=>a+b,0n);
function meanFractions(values: Fraction[]) {
  if(!values.length)return null;
  let n=0n,d=1n;
  for(const x of values){const xd=BigInt(x.denominator);n=n*xd+BigInt(x.numerator)*d;d*=xd;const g=gcd(n,d);n/=g;d/=g;}
  return fraction(n,d*BigInt(values.length));
}
export function percentile(values: bigint[],continuous: boolean) {
  if(!values.length)return null;
  const v=[...values].sort((a,b)=>a<b?-1:a>b?1:0);
  if(!continuous)return fraction(v[Math.ceil(v.length*.75)-1],10000n);
  const position=(v.length-1)*3,lo=Math.floor(position/4),r=BigInt(position%4);
  return fraction(v[lo]*4n+(v[Math.min(lo+1,v.length-1)]-v[lo])*r,40000n);
}
const byId=(a:Row,b:Row)=>String(a.customer_id??a.employee_id??'').localeCompare(String(b.customer_id??b.employee_id??''),'en');
export function calculate(data: Data,n=5) {
  const {customers,orders,details,employees}=data;
  const lines=new Map<number,Row[]>(); for(const d of details)lines.set(d.order_id,[...(lines.get(d.order_id)??[]),d]);
  const priced=orders.map((o): Row & {units:number;hasDetails:boolean;gross:bigint;net:bigint;freight4:bigint}=>{
    const ds=lines.get(o.order_id)??[];
    const gross=sum(ds.map(d=>scaled(d.unit_price,2)*BigInt(d.quantity)*100n));
    const net=sum(ds.map(d=>scaled(d.unit_price,2)*BigInt(d.quantity)*(100n-scaled(d.discount,2))));
    return {...o,units:ds.reduce((a,d)=>a+Number(d.quantity),0),hasDetails:ds.length>0,gross,net,freight4:scaled(o.freight??0,2)*100n};
  });
  const sorted=[...orders].sort((a,b)=>String(b.order_date??'').localeCompare(String(a.order_date??''))||b.order_id-a.order_id);
  const recent=sorted.slice(0,n), cutoff=recent.at(-1)?.order_date;
  const fold=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
  const cities=['London','london','LONDON','Mexico D.F.','mexico d.f.','México D.F.',' London '].map(city=>({city,
    exact:customers.filter(c=>c.city===city).length,
    caseInsensitive:customers.filter(c=>c.city!==null&&c.city.toLowerCase()===city.toLowerCase()).length,
    latinAccentFold:customers.filter(c=>c.city!==null&&fold(c.city)===fold(city)).length,
    trimAndCaseInsensitive:customers.filter(c=>c.city!==null&&c.city.trim().toLowerCase()===city.trim().toLowerCase()).length,
  }));
  const employeeRows=employees.map(e=>{
    const own=orders.filter(o=>o.employee_id===e.employee_id);
    return {employee_id:e.employee_id,orders:own.length,shipped:own.filter(o=>o.shipped_date!==null).length,unshipped:own.filter(o=>o.shipped_date===null).length};
  }).sort((a,b)=>a.employee_id-b.employee_id);
  const money: Record<string,unknown>={};
  for(const priceKind of ['gross','net','netWithFreight'] as const)for(const population of ['allOrders','withDetails'] as const){
    const included=priced.filter(o=>population==='allOrders'||o.hasDetails);
    const price=(o:typeof priced[number])=>priceKind==='gross'?o.gross:priceKind==='net'?o.net:o.net+o.freight4;
    const ratios=customers.map(c=>{
      const own=included.filter(o=>o.customer_id===c.customer_id);
      const p=sum(own.map(price)),f=sum(own.map(o=>o.freight4));
      const valid=own.map(o=>fraction(o.freight4,price(o))).filter((r):r is Fraction=>r!==null);
      const known=own.filter(o=>o.freight!==null);
      return {customer_id:c.customer_id,orders:own.length,freight: fraction(f,10000n),price:fraction(p,10000n),ratio: fraction(f,p),
        meanOrderRatio:meanFractions(valid),validRatioOrders:valid.length,
        ratioExcludingNullFreightOrders:fraction(sum(known.map(o=>o.freight4)),sum(known.map(price))),
        ratioUnknownIfAnyNullFreight:own.some(o=>o.freight===null)?null:fraction(f,p)};
    }).sort(byId);
    const countryValues=new Map<string|null,bigint[]>();let unmatchedCustomerOrders=0;
    for(const o of included){const c=customers.find(c=>c.customer_id===o.customer_id);if(!c){unmatchedCustomerOrders++;continue;}countryValues.set(c.country,[...(countryValues.get(c.country)??[]),price(o)]);}
    const countries=[...countryValues].map(([country,values])=>({country,orders:values.length,continuous:percentile(values,true),discrete:percentile(values,false)}))
      .sort((a,b)=>a.country===null?1:b.country===null?-1:a.country.localeCompare(b.country,'en'));
    money[`${priceKind}/${population}`]={ratios,customerIdsWithOrders:ratios.filter(r=>r.orders>0).map(r=>r.customer_id),countries,unmatchedCustomerOrders};
  }
  const numerator=BigInt(priced.reduce((a,o)=>a+o.units,0));
  return {counts:{customers:customers.length,orders:orders.length,details:details.length,employees:employees.length},
    recent:{n,exactN:recent.map(o=>o.order_id),excludeNullDates:sorted.filter(o=>o.order_date!==null).slice(0,n).map(o=>o.order_id),
      includeCutoffTies:n===0?[]:sorted.filter((o,i)=>i<n||o.order_date===cutoff).map(o=>o.order_id),byIdContrast:[...orders].sort((a,b)=>b.order_id-a.order_id).slice(0,n).map(o=>o.order_id)},
    cities,average:{units:String(numerator),allOrders: fraction(numerator,BigInt(orders.length)),withDetails:fraction(numerator,BigInt(priced.filter(o=>o.hasDetails).length)),
      lineQuantityContrast:fraction(BigInt(details.reduce((a,d)=>a+Number(d.quantity),0)),BigInt(details.length)),
      linesPerOrderContrast:fraction(BigInt(details.length),BigInt(orders.length)),zeroDetailOrders:priced.filter(o=>!o.hasDetails).length},
    employees:{all:employeeRows,withOrders:employeeRows.filter(e=>e.orders>0),unassignedOrderIds:orders.filter(o=>!employees.some(e=>e.employee_id===o.employee_id)).map(o=>o.order_id)},money};
}
