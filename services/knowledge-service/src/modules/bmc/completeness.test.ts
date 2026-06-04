import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { isBmcComplete } from './routes.js';
import { BMC_SECTIONS, type BmcData } from './service.js';

function fullBmc(): BmcData {
  const data: BmcData = {};
  for (const s of BMC_SECTIONS) data[s] = `${s} content that is long enough`;
  return data;
}

describe('isBmcComplete', () => {
  it('returns true when all 10 sections are filled past the threshold', () => {
    assert.equal(isBmcComplete(fullBmc()), true);
  });

  it('returns false when a section is missing', () => {
    const data = fullBmc();
    delete data.pricing;
    assert.equal(isBmcComplete(data), false);
  });

  it('returns false when a section is only whitespace', () => {
    const data = fullBmc();
    data.delivery = '   ';
    assert.equal(isBmcComplete(data), false);
  });

  it('returns false when a section is below the minimum length', () => {
    const data = fullBmc();
    data.usp = 'short'; // < 10 chars
    assert.equal(isBmcComplete(data), false);
  });

  it('returns false for an empty BMC', () => {
    assert.equal(isBmcComplete({}), false);
  });
});
