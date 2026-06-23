'use client';
// WaveHub — v55.83-MD. ONE guided Wave tab that replaces the three scattered ones (Wave Connection,
// Wave Import, Wave Sync Center) Max called "a big fucking mess." It re-parents the existing, already-tested
// components under a single step nav — Connect → Import/Mirror → Review & Push — so there is one clear path
// instead of three look-alike tabs. The child components are unchanged; this only frames + navigates them.
import React, { useState } from 'react';
import WaveConnectionTab from './WaveConnectionTab';
import WaveImportTab from './WaveImportTab';
import WaveSyncCenter from './WaveSyncCenter';

export default function WaveHub(props) {
  var canWaveSync = props.canWaveSync === true;
  var waveKey = props.waveKey || '';

  var steps = [
    ['connect', '1 · Connect', 'Bind your Wave business'],
    ['mirror', '2 · Import / Mirror', 'Pull customers, invoices & categories from Wave'],
  ];
  if (canWaveSync) { steps.push(['sync', '3 · Review & Push', 'Categorize, link, push to Wave + settings']); }

  // v55.83-ME — honor a deep-link's intended Wave sub-section so a "go to settings/import" jump doesn't
  // strand the user on Connect. initialWaveStep is 'connect' | 'mirror' | 'sync'.
  var s0 = useState(props.initialWaveStep || 'connect'); var step = s0[0]; var setStep = s0[1];
  // if the user loses sync access, never strand them on a hidden step
  if (step === 'sync' && !canWaveSync) { step = 'connect'; }

  function StepBtn(st) {
    var active = step === st[0];
    return (
      <button key={st[0]} onClick={function () { setStep(st[0]); }}
        className={'flex-1 min-w-[150px] text-left rounded-lg px-3 py-2 border transition ' + (active ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-800/70 border-slate-700 text-slate-200 hover:bg-slate-800')}>
        <div className="text-xs font-extrabold">{st[1]}</div>
        <div className={'text-[10px] ' + (active ? 'text-indigo-100' : 'text-slate-400')}>{st[2]}</div>
      </button>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">{steps.map(StepBtn)}</div>
      {step === 'connect' && <WaveConnectionTab {...props} onGoToImport={function () { setStep('mirror'); }} />}
      {step === 'mirror' && <WaveImportTab {...props} onGoToSync={function () { if (canWaveSync) { setStep('sync'); } }} />}
      {step === 'sync' && canWaveSync && <WaveSyncCenter key={'acct-sync|' + waveKey} {...props} onGoToWaveConnection={function () { setStep('connect'); }} />}
    </div>
  );
}
