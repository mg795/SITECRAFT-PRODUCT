'use strict';
/*
 * Where an account is in its migration, and what may happen next.
 *
 * Kept as a state machine with explicit transitions rather than a string somebody
 * sets from wherever, because two of these states are safety rails: a site cannot
 * reach the client before an administrator has approved it, and it cannot go live
 * before it has reached the client. Migration writes to staging and only ever to
 * staging (§14); putting a site on a public domain is a separate act with its own
 * approval, and nothing in this file performs it.
 */

const STATES = {
  not_started:   { label:'Not Started',          next:['crawling'] },
  crawling:      { label:'Crawling',             next:['processing','failed'] },
  processing:    { label:'Processing',           next:['reconstructed','failed'] },
  reconstructed: { label:'Site Reconstructed',   next:['issues','review','failed'] },
  issues:        { label:'Issues Found',         next:['review','crawling'] },
  review:        { label:'Admin Review Required',next:['approved','issues','crawling'] },
  approved:      { label:'Approved',             next:['client_ready','review'] },
  client_ready:  { label:'Ready for Client',     next:['live','review'] },
  live:          { label:'Live',                 next:['review'] },
  failed:        { label:'Migration Failed',     next:['crawling'] },
};

/* The two gates that exist to stop a mistake reaching a real business. */
const GATES = {
  approved:     'A site can only be approved once every critical exception is resolved.',
  client_ready: 'A client can only be invited to a site an administrator has approved.',
  live:         'Going live is a separate, deliberate act. Migration never performs it.',
};

function can(from, to, ctx = {}){
  const s = STATES[from];
  if (!s) return { ok:false, why:'Unknown state: ' + from };
  if (!s.next.includes(to)) return { ok:false, why:STATES[to] ? 'A site cannot go from ' + s.label + ' to ' + STATES[to].label + '.' : 'Unknown state: ' + to };
  if (to === 'approved' && ctx.criticalCount) 
    return { ok:false, why: GATES.approved + ' ' + ctx.criticalCount + ' remain.' };
  if (to === 'approved' && !ctx.reviewed)
    return { ok:false, why:'The site has to be reviewed before it can be approved.' };
  if (to === 'live' && !ctx.deployApproved)
    return { ok:false, why: GATES.live };
  return { ok:true };
}

/* Where a finished reconstruction lands, which is never further than review. */
const afterMigration = report =>
  report.counts.critical ? 'issues' : (report.counts.total ? 'issues' : 'reconstructed');

module.exports = { STATES, GATES, can, afterMigration };
