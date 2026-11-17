export const tolerances=Object.freeze({silhouetteIoU:.005,boundaryP95Px:.5,gapFill:.03,colorMAE:.015,normalMeanDeg:2,fractureDepthP95:.002,fractureLostArea:.02});
export const rowKey=r=>[r.fixture,r.view,r.size,r.profile].join('/');
export function regressionFailures(rows,baseline,{requireAll=true}={}) {
    const failures=[],previous=new Map(baseline.rows.map(r=>[rowKey(r),r]));
    const currentKeys=new Set();
    for(const row of rows) {
        const key=rowKey(row);if(currentKeys.has(key))failures.push(`Duplicate comparison: ${key}`);currentKeys.add(key);
        const old=previous.get(key);if(!old){failures.push(`Missing baseline: ${key}`);continue;}
        if(row.triangles!==old.triangles)failures.push(`${key} triangle count changed ${old.triangles} → ${row.triangles}`);
        for(const [metric,slack] of Object.entries(tolerances)) {
            const a=old.metrics[metric],b=row.metrics[metric];
            if(a!==null&&b===null){failures.push(`${key} ${metric} is no longer measurable`);continue;}
            if(b!==null&&!Number.isFinite(b)){failures.push(`${key} ${metric} is invalid`);continue;}
            if(a===null||b===null)continue;
            if(metric==='silhouetteIoU'?b<a-slack:b>a+slack)failures.push(`${key} ${metric} regressed: ${a.toFixed(4)} → ${b.toFixed(4)}`);
        }
    }
    if(requireAll&&(rows.length!==baseline.rows.length||baseline.rows.some(r=>!currentKeys.has(rowKey(r)))))failures.push('Visual matrix changed; review and explicitly update the baseline.');
    return failures;
}
