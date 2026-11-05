// Client clocks drift by seconds; every position calculation uses serverNow().
let offset = 0; // serverTime − localTime, in seconds

export async function syncServerClock(supabase) {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now() / 1000;
    const { data, error } = await supabase.rpc('get_server_time');
    const t1 = Date.now() / 1000;
    if (error || typeof data !== 'number') continue;
    samples.push({ rtt: t1 - t0, offset: data - (t0 + t1) / 2 });
  }
  if (samples.length) offset = samples.sort((a, b) => a.rtt - b.rtt)[0].offset;
}

export const serverNow = () => Date.now() / 1000 + offset;
