export const DEFAULT_BUDGETS='500, 750, 1000, 2000';
export function parseBudgets(input) {
    const parts=String(input).trim().split(/[\s,;]+/).filter(Boolean);
    if(!parts.length)throw Error('Enter at least one triangle budget.');
    if(parts.length>12)throw Error('Compare up to 12 budgets at a time.');
    if(parts.some(x=>!/^\d+$/.test(x)||Number(x)<24||Number(x)>50000))throw Error('Use whole-number budgets from 24 to 50,000, separated by commas.');
    return [...new Set(parts.map(Number))].sort((a,b)=>a-b);
}
export function curveSettingsKey({budgets,method,size,priority,tolerance,features}) {
    return JSON.stringify({budgets,method,size,priority,tolerance,features});
}
export function gpuVerdict(check) {
    if(!check||check.status==='unavailable')return 'Not checked';
    if(check.status==='not-visible')return 'No visible regions';
    if(!check.inScope)return check.failed?'Diagnostic · review':'Diagnostic only';
    return check.failed?'Review required':'Pass at 128 px';
}
