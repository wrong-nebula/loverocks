import {seeded} from './random.js';
// A synthetic daily climate in arbitrary units. Exposure drives art-directed
// SDF offsets, so the year labels describe elapsed time, not erosion rates.
const maxWeatherYears = 1000;
const climates = {
    alpine: { mean:5.0, swing:11.5, wet:0.37, rain:1.00, diurnal:2.4 },
    maritime: { mean:10.5, swing:5.8, wet:0.53, rain:1.48, diurnal:1.15 },
    continental: { mean:2.0, swing:16.2, wet:0.26, rain:0.76, diurnal:5.9 }
};

export function simulateClimate(seed, climate) {
    const random = seeded(seed + '/daily-weather');
    const runoff = new Float32Array(maxWeatherYears + 1);
    const frost = new Float32Array(maxWeatherYears + 1);
    const {mean,swing,wet,rain,diurnal} = climates[climate];
    const seasons = Array.from({length:365},(_,day) => -Math.cos(day*Math.PI*2/365));
    let snowpack = 0, poreWater = 0, frozen = false;
    let accumulatedRunoff = 0, accumulatedFrost = 0;
    for (let year = 1; year <= maxWeatherYears; ++year) {
        const annualAnomaly = (random() + random() - 1)*4.4;
        let anomaly = 0;
        for (const season of seasons) {
            anomaly = anomaly*0.59 + (random() + random() - 1)*8.4;
            const air = mean + swing*season + annualAnomaly + anomaly;
            const event = random();
            const amount = random();
            const precip = event < wet*(1-0.19*season) ? rain*(0.09+amount**3*1.24) : 0;
            if (air <= 0) snowpack += precip;
            const daytime = air + diurnal;
            const nighttime = air - diurnal;
            const melt = Math.min(snowpack,Math.max(0,daytime)*0.14);
            snowpack -= melt;
            const liquid = melt + (air > 0 ? precip : 0);
            accumulatedRunoff += liquid*(0.50 + 0.50*Math.min(1,liquid));
            poreWater = Math.min(1,poreWater*(frozen ? 0.96 : 0.72) + liquid*0.65);
            // A wet freeze counts once. Require a thaw before another cycle.
            if (frozen && daytime > 0.85) frozen = false;
            if (!frozen && nighttime < -0.65) {
                accumulatedFrost += poreWater**1.4*(0.34 + 0.66*Math.min(1,-nighttime/4));
                frozen = true;
            }
        }
        runoff[year] = accumulatedRunoff;
        frost[year] = accumulatedFrost;
    }
    return {runoff,frost};
}
