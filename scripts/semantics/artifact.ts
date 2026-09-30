import {createHash} from 'node:crypto';
import type {calculate} from './oracle.js';

export const resultHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Keep every variant's fingerprint, but only persist named contrasts as full rows. */
export function compactResults(results: ReturnType<typeof calculate>) {
  return {...results, money: Object.fromEntries(Object.entries(results.money).map(([name, value]) => {
    const branch = value as {ratios: Record<string, any>[]; countries: Record<string, any>[]; customerIdsWithOrders: string[]; unmatchedCustomerOrders: number};
    return [name, {
      fullBranchSha256: resultHash(branch),
      customerCount: branch.ratios.length,
      customersWithOrders: branch.customerIdsWithOrders.length,
      customerIdsWithoutOrders: branch.ratios.filter(r => r.orders === 0).map(r => r.customer_id),
      countryCount: branch.countries.length,
      unmatchedCustomerOrders: branch.unmatchedCustomerOrders,
      representativeRatios: branch.ratios.filter(r => r.customer_id === 'ALFKI'),
      representativeCountries: branch.countries.filter(r => r.country === 'Germany'),
    }];
  }))};
}
