import React from 'react';
import { ALL_KEYWORDS_MATCH, ANY_KEYWORD_MATCH, isKeywordMatch, PHRASE_MATCH } from '../lib/bank-rule-match';

const field = 'block px-2 py-1 rounded border border-slate-300 text-[11px] nt-light';
const colors = { background: '#fff', color: '#0f172a' };

export default function BankRuleMatchFields({ rule, onChange, disabled, allowKeywords = true }) {
  const mode = rule.match_mode || PHRASE_MATCH;
  const keyword = allowKeywords && isKeywordMatch(mode);
  const textLabel = allowKeywords ? (keyword ? 'Keywords' : 'Phrase') : 'Description contains';
  return <div className="flex flex-wrap gap-2 items-start">
    {allowKeywords && <label className="text-[11px] font-bold">Match type
      <select className={field} style={colors} value={mode} disabled={disabled} onChange={event => onChange({ ...rule, match_mode: event.target.value })}>
        <option value={PHRASE_MATCH}>Phrase</option>
        <option value={ALL_KEYWORDS_MATCH}>All keywords</option>
        <option value={ANY_KEYWORD_MATCH}>Any keyword</option>
      </select>
    </label>}
    <label className="text-[11px] font-bold">{textLabel}
      <input aria-label={textLabel} className={field} style={colors} value={rule.match_text} disabled={disabled} onChange={event => onChange({ ...rule, match_text: event.target.value })}
        placeholder={keyword ? 'e.g. intuit, quickbooks' : 'e.g. public service'} />
      {keyword && <span className="block font-normal">Separate words with commas or spaces. {mode === ALL_KEYWORDS_MATCH ? 'Every word must appear somewhere on the line, in any order.' : 'One whole word anywhere on the line is enough.'}</span>}
    </label>
  </div>;
}
