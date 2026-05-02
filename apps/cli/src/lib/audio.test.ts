import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { SpeakerMapper } from './audio.js';

describe('SpeakerMapper', () => {
  it('treats first seen speaker as rep, rest as customer', () => {
    const m = new SpeakerMapper();
    assert.equal(m.classify('Speaker 0'), 'rep');
    assert.equal(m.classify('Speaker 0'), 'rep');
    assert.equal(m.classify('Speaker 1'), 'customer');
    assert.equal(m.classify('Speaker 2'), 'customer');
  });

  it('forcedRep overrides auto-detect', () => {
    const m = new SpeakerMapper('Speaker 1');
    assert.equal(m.classify('Speaker 0'), 'customer');
    assert.equal(m.classify('Speaker 1'), 'rep');
  });

  it('setRep reclassifies subsequent turns', () => {
    const m = new SpeakerMapper();
    m.classify('Speaker 0'); // becomes rep
    m.setRep('Speaker 1');
    assert.equal(m.classify('Speaker 0'), 'customer');
    assert.equal(m.classify('Speaker 1'), 'rep');
  });
});
