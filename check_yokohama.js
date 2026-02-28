const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
    'https://ojkhwbvoaiaqekxrbpdd.supabase.co',
    'sb_secret_YTSjsm66P67WKiuXEEVIig_3NyBMHTl'
);

async function main() {
    // 1. major_area に「横浜」を含む
    const { data: d1 } = await supabase
        .from('hotels')
        .select('detail_area')
        .like('major_area', '%横浜%')
        .limit(3000);

    const c1 = {};
    for (const r of d1 || []) {
        const k = r.detail_area ?? '(NULL)';
        c1[k] = (c1[k] || 0) + 1;
    }
    console.log('=== major_area LIKE %横浜% ===');
    console.log('合計:', (d1||[]).length, '件');
    Object.entries(c1).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${k}: ${v}件`));

    // 2. address に「横浜市」を含む
    const { data: d2 } = await supabase
        .from('hotels')
        .select('detail_area')
        .like('address', '%横浜市%')
        .limit(3000);

    const c2 = {};
    for (const r of d2 || []) {
        const k = r.detail_area ?? '(NULL)';
        c2[k] = (c2[k] || 0) + 1;
    }
    console.log('\n=== address LIKE %横浜市% ===');
    console.log('合計:', (d2||[]).length, '件');
    Object.entries(c2).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${k}: ${v}件`));

    // 3. reports で flagged_at IS NOT NULL
    const { data: flags, count } = await supabase
        .from('reports')
        .select('*', { count: 'exact' })
        .not('flagged_at', 'is', null);
    console.log('\n=== reports: flagged_at IS NOT NULL ===');
    console.log('件数:', count);
    if (flags && flags.length > 0) {
        flags.forEach(r => console.log(`  id:${r.id} flagged_at:${r.flagged_at} flag_resolved:${r.flag_resolved} poster:${r.poster_name}`));
    }
}
main().catch(e => console.error(e));
