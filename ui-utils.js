// ==========================================================================
// ui-utils.js — toast、モーダル制御、DOM操作、多言語、SEO
// ==========================================================================

const TITLE_SUFFIX_MAP = {
    'men': 'Deli YobuHo',
    'women': 'JoFu YobuHo',
    'women_same': 'Same YobuHo',
    'men_same': 'Same YobuHo',
    'este': 'Este YobuHo'
};
const MODE_DESC_MAP = {
    'men': 'デリヘル（デリバリーヘルス・出張ヘルス）を呼べるホテルを全国43,000件以上から検索。ユーザー口コミと店舗情報のダブルチェックで信頼できるホテル情報。',
    'women': '女性用風俗（女風）・出張マッサージ・セラピストを呼べるホテルを全国43,000件以上から検索。口コミと店舗情報で安心のホテル選び。',
    'men_same': '男性同士（ゲイカップル）で利用できるホテルを全国43,000件以上から検索。LGBTフレンドリーなホテル情報を口コミでチェック。',
    'women_same': '女性同士（レズビアンカップル）で利用できるホテルを全国43,000件以上から検索。LGBTフレンドリーなホテル情報を口コミでチェック。',
    'este': 'デリエステ（風俗エステ・回春マッサージ・M性感）を呼べるホテルを全国43,000件以上から検索。ユーザー口コミと店舗情報で信頼できるホテル情報。'
};
function getSiteSuffix() {
    const mode = window.MODE || new URLSearchParams(window.location.search).get('mode') || 'men';
    return TITLE_SUFFIX_MAP[mode] || 'YobuHo';
}
function updatePageTitle(prefix) {
    document.title = prefix + ' | ' + getSiteSuffix();
    // Update meta description based on mode
    const mode = window.MODE || new URLSearchParams(window.location.search).get('mode') || 'men';
    const descMeta = document.querySelector('meta[name="description"]');
    if (descMeta && MODE_DESC_MAP[mode]) descMeta.content = MODE_DESC_MAP[mode];
    // Update OG tags
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogTitle) ogTitle.content = document.title;
    if (ogDesc && MODE_DESC_MAP[mode]) ogDesc.content = MODE_DESC_MAP[mode];
    // Update JSON-LD
    const ldScript = document.querySelector('script[type="application/ld+json"]');
    if (ldScript) {
        try {
            const ld = JSON.parse(ldScript.textContent);
            ld.name = document.title;
            ld.description = descMeta?.content || '';
            ldScript.textContent = JSON.stringify(ld);
        } catch(e) {}
    }
}

const state = { lang: localStorage.getItem('yobuho_lang') || 'ja' };
const LANG = {
    ja: {
        select_area: '地域を選択', japan: '日本全国', back: '前へ',
        search_placeholder: 'ホテル名・住所・キーワードで検索...',
        station_placeholder: '最寄駅で検索...',
        list_placeholder: '市区町村まで選択するとホテルが表示されます',
        results: '件のホテル', no_results: 'ホテルが見つかりませんでした',
        nearest: '最寄駅', no_data: 'データがありません',
        show_all: 'このエリア全体を見る',
        current_location: '現在地',
        locating: '位置情報を取得中...', location_error: '位置情報を取得できませんでした',
        nearby: '現在地から近い順',
        can_call: '呼べた', cannot_call: '呼べなかった',
        no_reports: '投稿なし',
        view_detail: '詳細を見る',
        submit: '投稿する', cancel: 'キャンセル', confirm: '決定する',
        loading: '読み込み中...',
        filter_all: 'すべて', filter_business: 'ビジネス', filter_city: 'シティ',
        filter_resort: 'リゾート', filter_ryokan: '旅館', filter_loveho: 'ラブホ',
        terms: '利用規約', privacy: 'プライバシーポリシー', contact: 'お問い合わせ',
        top_page: 'トップページ', shop_register: '店舗登録',
        select_reason: '理由を選んでください',
        post_success: '投稿ありがとうございます', post_error: '送信エラー',
        // タブ・ボタン
        hotel_tab: '🏨 ホテル', loveho_tab: '🏩 ラブホ',
        post_review: '📝 口コミを投稿', view_reviews: '✨ 口コミを見る',
        post_hotel_review: '📝 口コミを投稿する', post_loveho_review: '🏩 口コミを投稿する',
        load_more: 'もっと見る', show_more_reviews: '他{n}件の口コミを表示',
        check_now: '✨ 今すぐCHECK！',
        view_map: '地図で見る', view_list: 'リストで見る',
        to_nationwide: '全国へ', back_button: '← 戻る',
        // バッジ・ステータス
        certified_shop: '認定店', guide_available: '✅ ご案内実績あり', guide_unavailable: '❌ ご案内不可',
        guide_success: '✅ ご案内実績有り',
        solo_can: '🚪 一人で先に入れた', solo_ng: '🚪 一人で先に入れなかった', solo_together: '🚪 一緒に入った',
        solo_entry_yes: '🚪 一人で先に？', solo_entry_together: '🚪 一緒に入室', solo_entry_no: '🚪 一人で先に？ 不可',
        transport_fee: '🚕 交通費:', additional_fee: '💰追加料金あり',
        multi_person_ok: '👥 複数人利用OK', report_btn: '🚩 報告',
        shop_provided_info: '🏢 店舗提供情報',
        shop_official_info: '✅ お店からの公式情報',
        user_reviews: 'ユーザー口コミ', review_list: '口コミ一覧',
        no_posts_yet: 'まだ投稿がありません',
        // フォームラベル
        poster_name: '投稿者名', poster_name_opt: '投稿者名 （任意）',
        anon_placeholder: '未入力の場合は「匿名希望」で表示されます',
        anon_default: '匿名希望',
        result_label: '結果', result_required: '必須',
        time_slot: '利用時間帯', room_type: '部屋タイプ',
        free_comment: 'フリーコメント', comment_placeholder: '良かった点、気になった点など',
        can_call_reason: '呼べた理由', cannot_call_reason: '呼べなかった理由',
        add_reason: '＋ 理由を選択（任意）',
        atmosphere: '✨雰囲気', facilities: '🛁設備･お部屋', service: '🏨サービス･利便性',
        solo_entry_label: '一人で先に入れる？', guide_track: 'ご案内実績',
        // 入室方法
        entry_front: 'フロント経由(部屋番号を伝えて入室)', entry_direct: '直接入室(お部屋に直行)',
        entry_lobby: 'ロビー待ち合わせ', entry_waiting: '待合室で待ち合わせ',
        // メッセージ
        sending: '送信中...', network_error: '通信エラーが発生しました',
        select_call_result: '「呼べた」か「呼べなかった」を選択してください',
        confirm_post: 'この内容で投稿する',
        review_submitted: '口コミが投稿されました。',
        post_thanks: '口コミを投稿しました。ありがとうございます！',
        posting_limit: '投稿制限中です。しばらく時間をおいてから再度お試しください。',
        already_posted: 'このホテルへは既に投稿済みです',
        hotel_not_selected: 'ホテルが選択されていません。ページを再読み込みしてください。',
        min_fields_required: '少なくとも1つ以上の項目を入力してください',
        already_voted: '既に評価済みです', vote_failed: '評価に失敗しました',
        marked_helpful: '👍 参考になりました', marked_unhelpful: '👎 評価しました',
        report_accepted: '🚩 報告を受け付けました。ご協力ありがとうございます。',
        report_failed: '報告の送信に失敗しました',
        report_target_error: '報告対象が不明です。ページを再読み込みしてください。',
        load_error: '読み込みエラーが発生しました',
        // 検索・ナビ
        loveho_count: '{n} 件のラブホテル', no_loveho_found: 'ラブホテルが見つかりませんでした',
        no_station_found: '該当する駅が見つかりません',
        move_to_location: '現在地へ移動',
        location_denied: '位置情報の使用が許可されていません',
        location_failed: '位置情報を取得できませんでした',
        location_timeout: 'タイムアウトしました',
        no_location_hotels: '位置情報のあるホテルがありません',
        map_load_error: '地図ライブラリの読み込みに失敗しました',
        hotel_not_listed: '📝 未掲載ホテル情報提供',
        shop_register_link: '🏪 店舗様・掲載用はこちら',
        other_areas: 'その他のエリア',
        // 複数人
        guest_male: '男性', guest_female: '女性',
        // 未選択
        unselected: '未選択',
        shop_registered: '様 ご登録いただきました',
    },
    en: {
        select_area: 'Select Area', japan: 'All Japan', back: 'Back',
        search_placeholder: 'Hotel name, address, keyword...',
        station_placeholder: 'Search by station',
        list_placeholder: 'Select a city to view hotels',
        results: 'hotels', no_results: 'No hotels found',
        nearest: 'Station', no_data: 'No data', show_all: 'View all',
        current_location: 'Location',
        locating: 'Getting location...', location_error: 'Could not get location',
        nearby: 'Near you',
        can_call: 'Available', cannot_call: 'Unavailable',
        no_reports: 'No reviews',
        view_detail: 'View Details',
        submit: 'Submit', cancel: 'Cancel', confirm: 'Confirm',
        loading: 'Loading...',
        filter_all: 'All', filter_business: 'Business', filter_city: 'City',
        filter_resort: 'Resort', filter_ryokan: 'Ryokan', filter_loveho: 'Love Hotel',
        terms: 'Terms', privacy: 'Privacy Policy', contact: 'Contact',
        top_page: 'Top Page', shop_register: 'Shop Registration',
        select_reason: 'Select a reason',
        post_success: 'Thank you for your review', post_error: 'Submission error',
        hotel_tab: '🏨 Hotel', loveho_tab: '🏩 Love Hotel',
        post_review: '📝 Post Review', view_reviews: '✨ Reviews',
        post_hotel_review: '📝 Post a Review', post_loveho_review: '🏩 Post a Review',
        load_more: 'Load More', show_more_reviews: 'Show {n} more reviews',
        check_now: '✨ CHECK NOW!',
        view_map: 'Map View', view_list: 'List View',
        to_nationwide: 'All Japan', back_button: '← Back',
        certified_shop: 'Certified', guide_available: '✅ Available', guide_unavailable: '❌ Unavailable',
        guide_success: '✅ Verified',
        solo_can: '🚪 Solo check-in OK', solo_ng: '🚪 Solo check-in NG', solo_together: '🚪 Entered together',
        solo_entry_yes: '🚪 Solo OK?', solo_entry_together: '🚪 Together', solo_entry_no: '🚪 Solo NG',
        transport_fee: '🚕 Transport:', additional_fee: '💰Extra fee',
        multi_person_ok: '👥 Multiple guests OK', report_btn: '🚩 Report',
        shop_provided_info: '🏢 Shop Info',
        shop_official_info: '✅ Official Shop Info',
        user_reviews: 'User Reviews', review_list: 'Reviews',
        no_posts_yet: 'No reviews yet',
        poster_name: 'Name', poster_name_opt: 'Name (optional)',
        anon_placeholder: 'Anonymous if left blank',
        anon_default: 'Anonymous',
        result_label: 'Result', result_required: 'Required',
        time_slot: 'Time', room_type: 'Room Type',
        free_comment: 'Comment', comment_placeholder: 'Good points, concerns, etc.',
        can_call_reason: 'Reason available', cannot_call_reason: 'Reason unavailable',
        add_reason: '+ Select reason (optional)',
        atmosphere: '✨Atmosphere', facilities: '🛁Facilities', service: '🏨Service',
        solo_entry_label: 'Solo check-in?', guide_track: 'Track record',
        entry_front: 'Via front desk', entry_direct: 'Direct to room',
        entry_lobby: 'Meet at lobby', entry_waiting: 'Meet at waiting room',
        sending: 'Sending...', network_error: 'Network error',
        select_call_result: 'Select Available or Unavailable',
        confirm_post: 'Submit this review',
        review_submitted: 'Review submitted.',
        post_thanks: 'Thank you for your review!',
        posting_limit: 'Posting limit reached. Please try again later.',
        already_posted: 'You have already posted for this hotel',
        hotel_not_selected: 'No hotel selected. Please reload the page.',
        min_fields_required: 'Please fill in at least one field',
        already_voted: 'Already voted', vote_failed: 'Vote failed',
        marked_helpful: '👍 Helpful', marked_unhelpful: '👎 Not helpful',
        report_accepted: '🚩 Report accepted. Thank you.',
        report_failed: 'Failed to submit report',
        report_target_error: 'Unknown report target. Please reload.',
        load_error: 'Loading error',
        loveho_count: '{n} love hotels', no_loveho_found: 'No love hotels found',
        no_station_found: 'No matching station found',
        move_to_location: 'Go to current location',
        location_denied: 'Location access denied',
        location_failed: 'Could not get location',
        location_timeout: 'Location timeout',
        no_location_hotels: 'No hotels with location data',
        map_load_error: 'Failed to load map',
        hotel_not_listed: '📝 Report unlisted hotel',
        shop_register_link: '🏪 For shops',
        other_areas: 'Other areas',
        guest_male: 'Male', guest_female: 'Female',
        unselected: 'Not selected',
        shop_registered: 'has registered',
    },
    zh: {
        select_area: '选择地区', japan: '全日本', back: '返回',
        search_placeholder: '酒店名·地址·关键词搜索...',
        station_placeholder: '按车站搜索',
        list_placeholder: '请选择城市查看酒店',
        results: '家酒店', no_results: '未找到酒店',
        nearest: '最近车站', no_data: '没有数据', show_all: '查看全部',
        current_location: '当前位置',
        locating: '获取位置中...', location_error: '无法获取位置',
        nearby: '离您最近',
        can_call: '可以叫', cannot_call: '不能叫',
        no_reports: '暂无评价',
        view_detail: '查看详情',
        submit: '提交', cancel: '取消', confirm: '确定',
        loading: '加载中...',
        filter_all: '全部', filter_business: '商务', filter_city: '城市',
        filter_resort: '度假', filter_ryokan: '旅馆', filter_loveho: '情侣酒店',
        terms: '使用条款', privacy: '隐私政策', contact: '联系我们',
        top_page: '首页', shop_register: '店铺注册',
        select_reason: '请选择原因',
        post_success: '感谢您的评价', post_error: '提交错误',
        hotel_tab: '🏨 酒店', loveho_tab: '🏩 情侣酒店',
        post_review: '📝 发表评价', view_reviews: '✨ 查看评价',
        post_hotel_review: '📝 发表评价', post_loveho_review: '🏩 发表评价',
        load_more: '加载更多', show_more_reviews: '显示其他{n}条评价',
        check_now: '✨ 立即查看！',
        view_map: '地图', view_list: '列表',
        to_nationwide: '全国', back_button: '← 返回',
        certified_shop: '认证店', guide_available: '✅ 可派遣', guide_unavailable: '❌ 不可派遣',
        guide_success: '✅ 有派遣实绩',
        solo_can: '🚪 可单独入住', solo_ng: '🚪 不可单独入住', solo_together: '🚪 一起入住',
        solo_entry_yes: '🚪 可单独？', solo_entry_together: '🚪 一起入住', solo_entry_no: '🚪 不可单独',
        transport_fee: '🚕 交通费:', additional_fee: '💰附加费',
        multi_person_ok: '👥 多人可', report_btn: '🚩 举报',
        shop_provided_info: '🏢 店铺信息',
        shop_official_info: '✅ 店铺官方信息',
        user_reviews: '用户评价', review_list: '评价列表',
        no_posts_yet: '暂无评价',
        poster_name: '姓名', poster_name_opt: '姓名（可选）',
        anon_placeholder: '未填写则显示为匿名',
        anon_default: '匿名',
        result_label: '结果', result_required: '必填',
        time_slot: '时间段', room_type: '房型',
        free_comment: '评论', comment_placeholder: '优点、注意事项等',
        can_call_reason: '可叫原因', cannot_call_reason: '不可叫原因',
        add_reason: '+ 选择原因（可选）',
        atmosphere: '✨氛围', facilities: '🛁设施·房间', service: '🏨服务·便利性',
        solo_entry_label: '可单独入住？', guide_track: '派遣实绩',
        entry_front: '经前台（告知房号）', entry_direct: '直接入室',
        entry_lobby: '大厅见面', entry_waiting: '等候室见面',
        sending: '发送中...', network_error: '网络错误',
        select_call_result: '请选择"可以叫"或"不能叫"',
        confirm_post: '提交此评价',
        review_submitted: '评价已提交。',
        post_thanks: '感谢您的评价！',
        posting_limit: '提交受限，请稍后再试。',
        already_posted: '已对该酒店发表过评价',
        hotel_not_selected: '未选择酒店，请刷新页面。',
        min_fields_required: '请至少填写一项',
        already_voted: '已评价', vote_failed: '评价失败',
        marked_helpful: '👍 有帮助', marked_unhelpful: '👎 已评价',
        report_accepted: '🚩 已受理举报，感谢配合。',
        report_failed: '举报发送失败',
        report_target_error: '举报对象不明，请刷新页面。',
        load_error: '加载错误',
        loveho_count: '{n} 家情侣酒店', no_loveho_found: '未找到情侣酒店',
        no_station_found: '未找到匹配车站',
        move_to_location: '定位当前位置',
        location_denied: '位置权限被拒绝',
        location_failed: '无法获取位置',
        location_timeout: '获取超时',
        no_location_hotels: '没有含位置信息的酒店',
        map_load_error: '地图加载失败',
        hotel_not_listed: '📝 未收录酒店信息提供',
        shop_register_link: '🏪 店铺注册',
        other_areas: '其他地区',
        guest_male: '男性', guest_female: '女性',
        unselected: '未选择',
        shop_registered: '已注册',
    },
    ko: {
        select_area: '지역 선택', japan: '일본 전국', back: '뒤로',
        search_placeholder: '호텔명·주소·키워드 검색...',
        station_placeholder: '역명으로 검색',
        list_placeholder: '도시를 선택하면 호텔이 표시됩니다',
        results: '개 호텔', no_results: '호텔을 찾을 수 없습니다',
        nearest: '역', no_data: '데이터 없음', show_all: '전체 보기',
        current_location: '현재 위치',
        locating: '위치 가져오는 중...', location_error: '위치를 가져올 수 없습니다',
        nearby: '가까운 순',
        can_call: '가능', cannot_call: '불가능',
        no_reports: '리뷰 없음',
        view_detail: '상세 보기',
        submit: '제출', cancel: '취소', confirm: '확인',
        loading: '로딩 중...',
        filter_all: '전체', filter_business: '비즈니스', filter_city: '시티',
        filter_resort: '리조트', filter_ryokan: '료칸', filter_loveho: '러브호텔',
        terms: '이용약관', privacy: '개인정보처리방침', contact: '문의',
        top_page: '홈', shop_register: '매장 등록',
        select_reason: '이유를 선택하세요',
        post_success: '리뷰를 남겨주셔서 감사합니다', post_error: '제출 오류',
        hotel_tab: '🏨 호텔', loveho_tab: '🏩 러브호텔',
        post_review: '📝 리뷰 작성', view_reviews: '✨ 리뷰 보기',
        post_hotel_review: '📝 리뷰 작성', post_loveho_review: '🏩 리뷰 작성',
        load_more: '더 보기', show_more_reviews: '다른 {n}개 리뷰 보기',
        check_now: '✨ 지금 확인!',
        view_map: '지도', view_list: '목록',
        to_nationwide: '전국', back_button: '← 뒤로',
        certified_shop: '인증', guide_available: '✅ 가능', guide_unavailable: '❌ 불가',
        guide_success: '✅ 실적 있음',
        solo_can: '🚪 혼자 체크인 가능', solo_ng: '🚪 혼자 체크인 불가', solo_together: '🚪 함께 입실',
        solo_entry_yes: '🚪 혼자 가능?', solo_entry_together: '🚪 함께 입실', solo_entry_no: '🚪 혼자 불가',
        transport_fee: '🚕 교통비:', additional_fee: '💰추가요금',
        multi_person_ok: '👥 다인 이용 가능', report_btn: '🚩 신고',
        shop_provided_info: '🏢 매장 정보',
        shop_official_info: '✅ 매장 공식 정보',
        user_reviews: '사용자 리뷰', review_list: '리뷰 목록',
        no_posts_yet: '아직 리뷰가 없습니다',
        poster_name: '이름', poster_name_opt: '이름 (선택)',
        anon_placeholder: '미입력 시 익명으로 표시됩니다',
        anon_default: '익명',
        result_label: '결과', result_required: '필수',
        time_slot: '시간대', room_type: '방 유형',
        free_comment: '코멘트', comment_placeholder: '좋았던 점, 신경 쓰인 점 등',
        can_call_reason: '가능 사유', cannot_call_reason: '불가 사유',
        add_reason: '+ 사유 선택 (선택사항)',
        atmosphere: '✨분위기', facilities: '🛁시설·객실', service: '🏨서비스·편의성',
        solo_entry_label: '혼자 체크인?', guide_track: '실적',
        entry_front: '프론트 경유(룸번호 전달)', entry_direct: '직접 입실',
        entry_lobby: '로비 만남', entry_waiting: '대기실 만남',
        sending: '전송 중...', network_error: '네트워크 오류',
        select_call_result: '"가능" 또는 "불가능"을 선택하세요',
        confirm_post: '이 내용으로 제출',
        review_submitted: '리뷰가 제출되었습니다.',
        post_thanks: '리뷰를 남겨주셔서 감사합니다!',
        posting_limit: '제출 제한 중입니다. 잠시 후 다시 시도하세요.',
        already_posted: '이미 이 호텔에 리뷰를 남겼습니다',
        hotel_not_selected: '호텔이 선택되지 않았습니다. 페이지를 새로고침하세요.',
        min_fields_required: '최소 1개 항목을 입력해 주세요',
        already_voted: '이미 평가함', vote_failed: '평가 실패',
        marked_helpful: '👍 도움이 됨', marked_unhelpful: '👎 평가함',
        report_accepted: '🚩 신고가 접수되었습니다. 감사합니다.',
        report_failed: '신고 전송 실패',
        report_target_error: '신고 대상 불명. 페이지를 새로고침하세요.',
        load_error: '로딩 오류',
        loveho_count: '{n}개 러브호텔', no_loveho_found: '러브호텔을 찾을 수 없습니다',
        no_station_found: '해당 역을 찾을 수 없습니다',
        move_to_location: '현재 위치로 이동',
        location_denied: '위치 권한이 거부되었습니다',
        location_failed: '위치를 가져올 수 없습니다',
        location_timeout: '시간 초과',
        no_location_hotels: '위치 정보가 있는 호텔이 없습니다',
        map_load_error: '지도 로드 실패',
        hotel_not_listed: '📝 미등록 호텔 제보',
        shop_register_link: '🏪 매장 등록',
        other_areas: '기타 지역',
        guest_male: '남성', guest_female: '여성',
        unselected: '미선택',
        shop_registered: '등록되었습니다',
    },
};
function t(key) { return (LANG[state.lang] || LANG.ja)[key] || key; }

function changeLang(lang) {
    state.lang = lang;
    localStorage.setItem('yobuho_lang', lang);
    const langLabels = { ja: 'JP', en: 'EN', zh: 'CN', ko: 'KR' };
    document.querySelectorAll('.lang-menu-item').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-action="changeLang"][data-param="${lang}"]`)?.classList.add('active');
    const toggle = document.querySelector('.lang-toggle');
    if (toggle) toggle.textContent = '🌐 ' + (langLabels[lang] || 'JP');
    document.querySelector('.lang-dropdown')?.classList.remove('open');
    updateUILanguage();
    if (currentPage) currentPage();
}

function updateUILanguage() {
    // エリアタイトル（デフォルトテキストの場合のみ更新）
    const areaTitle = document.getElementById('area-title');
    if (areaTitle) {
        const defaultTitles = ['地域を選択', 'Select Area', '选择地区', '지역 선택'];
        if (defaultTitles.includes(areaTitle.textContent)) {
            areaTitle.textContent = t('select_area');
        }
    }

    // 検索プレースホルダー
    const searchInput = document.querySelector('.search-input-lux');
    if (searchInput) searchInput.placeholder = t('search_placeholder');
    const stationInput = document.querySelector('.station-input');
    if (stationInput) stationInput.placeholder = t('station_placeholder');

    // 現在地ボタン
    const locLabel = document.querySelector('.btn-location-label');
    if (locLabel) locLabel.textContent = t('current_location');

    // 戻るボタン
    const backText = document.querySelector('.back-text');
    if (backText) backText.textContent = t('back');

    // フィルタチップ（data-filter-key属性を使って翻訳）
    document.querySelectorAll('.filter-chip[data-filter-key]').forEach(chip => {
        chip.textContent = t(chip.dataset.filterKey);
    });

    // フッターリンク
    document.querySelectorAll('.footer-link').forEach(link => {
        const href = link.getAttribute('href') || '';
        if (href.includes('terms')) link.textContent = t('terms');
        else if (href.includes('privacy')) link.textContent = t('privacy');
        else if (href.includes('contact')) link.textContent = t('contact');
        else if (href.includes('index.html')) link.textContent = t('top_page');
        else if (href.includes('shop-register')) link.textContent = t('shop_register');
    });
}

function setTitle(text) {
    const el = document.getElementById('area-title');
    if (el) el.textContent = text;
}

function setBackBtn(show) {
    const el = document.getElementById('btn-area-back');
    if (el) el.style.display = show ? 'flex' : 'none';
}

function setBreadcrumb(crumbs) {
    const html = crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return `
            ${i > 0 ? '<span class="breadcrumb-sep">›</span>' : ''}
            <span class="breadcrumb-item ${isLast ? 'active' : ''}"
                  ${!isLast && c.onclick ? `style="cursor:pointer" onclick="${c.onclick}"` : ''}>
                ${esc(c.label)}
            </span>`;
    }).join('');
    const el = document.getElementById('breadcrumb');
    if (el) el.innerHTML = html;
}

function clearHotelList() {
    const el = document.getElementById('hotel-list');
    if (el) el.innerHTML = '';
    const s = document.getElementById('result-status');
    if (s) s.style.display = 'none';
    const links = document.getElementById('bottom-info-links');
    if (links) links.style.display = 'none';
    hideLovehoTabs();
    if (typeof hideFilterBar === 'function') hideFilterBar();
    if (typeof hideMap === 'function') hideMap();
}

function showToast(msg, duration = 2500) {
    let el = document.getElementById('toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast';
        el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translateX(-50%) translateY(calc(-50% - 12px));background:#1a1410;color:#fff;padding:12px 24px;border-radius:30px;font-size:13px;opacity:0;transition:all 0.3s;z-index:9999;white-space:nowrap;pointer-events:none;';
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(-50%)';
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(calc(-50% - 12px))';
    }, duration);
}

function showSuccessModal(title, message) {
    document.getElementById('success-modal-title').textContent = title;
    document.getElementById('success-modal-message').textContent = message || '';
    document.getElementById('success-modal').style.display = 'flex';
}
function closeSuccessModal() {
    document.getElementById('success-modal').style.display = 'none';
}

// モーダル背景クリックで閉じる
document.addEventListener('click', function(e) {
    // ドロップダウン外クリックで閉じる
    if (!e.target.closest('.lang-dropdown')) {
        document.querySelector('.lang-dropdown')?.classList.remove('open');
    }
    if (!e.target.closest('.mode-dropdown')) {
        document.querySelector('.mode-dropdown')?.classList.remove('open');
    }
    if (!e.target.classList.contains('modal-overlay') && !e.target.classList.contains('modal-overlay-success')) return;
    const map = {
        'can-reasons-modal': 'cancelCanReasons',
        'cannot-reasons-modal': 'cancelCannotReasons',
        'post-confirm-modal': 'closePostConfirmModal',
        'hotel-report-form-modal': 'closeHotelReportFormModal',
        'loveho-report-form-modal': 'closeLovehoReportFormModal',
        'flag-modal': 'closeFlagModal',
        'hotel-request-modal': 'closeHotelRequestModal',
        'correction-modal': 'closeCorrectionModal',
        'success-modal': 'closeSuccessModal',
    };
    const fn = map[e.target.id];
    if (fn && typeof window[fn] === 'function') window[fn]();
    else e.target.style.display = 'none';
});

function showLoading(msg) {
    const el = document.getElementById('loading-overlay');
    if (el) {
        el.style.display = 'flex';
        const txt = el.querySelector('.loading-text');
        if (txt) txt.textContent = msg || t('loading');
    }
}

function hideLoading() {
    const el = document.getElementById('loading-overlay');
    if (el) el.style.display = 'none';
}

function showSkeletonLoader() {
    const container = document.getElementById('hotel-list');
    if (!container) return;
    container.innerHTML = Array(5).fill(0).map(() =>
        '<div class="skeleton skeleton-card"></div>'
    ).join('');
}

function buildAreaButtons(items, onAllClick, onItemClick, hasChildren = true) {
    const container = document.getElementById('area-button-container');
    container.innerHTML = '';
    container.className = 'area-grid col-2';

    items.forEach((item, i) => {
        const btn = document.createElement('button');
        btn.className = `area-btn ${hasChildren ? 'has-children' : ''}`;
        btn.style.animationDelay = `${Math.min(i * 0.03, 0.3)}s`;
        btn.textContent = item;
        btn.onclick = () => onItemClick(item);
        container.appendChild(btn);
    });

    if (onAllClick) {
        const allBtn = document.createElement('button');
        allBtn.className = 'area-btn all-btn';
        allBtn.style.cssText = 'grid-column:1/-1; margin-top:8px;';
        allBtn.textContent = `▶ ${t('show_all')}`;
        allBtn.onclick = onAllClick;
        container.appendChild(allBtn);
    }
}

function extractCity(address) {
    if (!address) return null;

    const PREFS = [
        '北海道',
        '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
        '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
        '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県',
        '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
        '鳥取県', '島根県', '岡山県', '広島県', '山口県',
        '徳島県', '香川県', '愛媛県', '高知県',
        '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
    ];

    let after = address;
    for (const pref of PREFS) {
        if (address.startsWith(pref)) {
            after = address.slice(pref.length).trimStart();
            break;
        }
    }
    if (!after) return null;

    const base = after.replace(/^[\u4E00-\u9FFF\u3040-\u30FF]{1,5}郡/, '');
    let m;

    m = base.match(/^((?:(?!区)[\u4E00-\u9FFF\u3040-\u30FF]){1,10}?市)/);
    if (m) return m[1];

    m = base.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,6}?区)/);
    if (m) return m[1];

    m = after.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,5}郡[\u4E00-\u9FFF\u3040-\u30FF]{1,5}[町村])/);
    if (m) return m[1];

    m = after.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,6}郡)/);
    if (m) return m[1];

    m = after.match(/^([\u4E00-\u9FFF\u3040-\u30FF]{1,6}[町村])/);
    if (m) return m[1];

    return null;
}

function hotelRankBadge(_score) {
    return '';
}

function freshnessLabel(isoDate) {
    if (!isoDate) return '';
    const diff = Math.floor((Date.now() - new Date(isoDate)) / 86400000);
    if      (diff === 0)  return '<span class="freshness fresh">本日更新</span>';
    else if (diff <= 7)   return `<span class="freshness recent">${diff}日前に更新</span>`;
    else if (diff <= 30)  return `<span class="freshness normal">${diff}日前に更新</span>`;
    else                  return `<span class="freshness old">${diff}日前に更新</span>`;
}

function calcDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatDate(iso) {
    if (!iso) return '';
    const s = String(iso).replace('T',' ').replace(/Z$/,'');
    const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}/${m[2]}/${m[3]}`;
    return s.slice(0,10);
}

function formatTransportFee(val) {
    if (val === null || val === undefined || val === '') return null;
    if (val === 0 || val === '0') return '無料';
    const num = parseInt(String(val).replace(/,/g, ''), 10);
    if (isNaN(num)) return null;
    return '¥' + num.toLocaleString('ja-JP') + '-';
}

function buildDonutSVG(greenCount, redCount, size = 60, showPct = false) {
    const r = 22, sw = 8;
    const cx = size / 2, cy = size / 2;
    const C = 2 * Math.PI * r;
    const total = greenCount + redCount;
    if (total === 0) return '';
    const gLen = (greenCount / total) * C;
    const rLen = (redCount / total) * C;
    const off = (C * 0.25).toFixed(2);
    const offR = (C * 0.25 - gLen).toFixed(2);
    const pct = Math.round((greenCount / total) * 100);
    const pctColor = greenCount >= redCount ? '#3a9a60' : '#c05050';
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block;flex-shrink:0;">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(0,0,0,0.07)" stroke-width="${sw}"/>
      ${gLen > 0 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#3a9a60" stroke-width="${sw}" stroke-dasharray="${gLen.toFixed(2)} ${(C - gLen).toFixed(2)}" stroke-dashoffset="${off}"/>` : ''}
      ${rLen > 0 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#c05050" stroke-width="${sw}" stroke-dasharray="${rLen.toFixed(2)} ${(C - rLen).toFixed(2)}" stroke-dashoffset="${offR}"/>` : ''}
      ${showPct ? `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" style="font-size:11px;font-weight:700;fill:${pctColor};">${pct}%</text>` : ''}
    </svg>`;
}

function getReportCount(h) {
    const s = h.summary;
    if (!s) return 0;
    if (s.total_reports != null) return s.total_reports;
    return (s.can_call_count||0) + (s.cannot_call_count||0) + (s.shop_can_count||0) + (s.shop_ng_count||0);
}

const HOTEL_TYPE_ORDER = { business: 0, city: 1, resort: 2, ryokan: 3, pension: 4, minshuku: 5, other: 6 };
function sortHotelsByReviews(hotels) {
    hotels.sort((a, b) => {
        const ca = getReportCount(a), cb = getReportCount(b);
        if (ca !== cb) return cb - ca;
        const da = a.latestReportAt || '', db = b.latestReportAt || '';
        if (da !== db) return da < db ? 1 : -1;
        const ta = HOTEL_TYPE_ORDER[a.hotel_type] ?? 6, tb = HOTEL_TYPE_ORDER[b.hotel_type] ?? 6;
        if (ta !== tb) return ta - tb;
        return (a.name || '').localeCompare(b.name || '', 'ja');
    });
    return hotels;
}

function applyKeywordFilter(query, rawKeyword) {
    if (!rawKeyword) return query;
    const words = rawKeyword.trim().split(/[\s　]+/).filter(w => w.length > 0);
    for (const word of words) {
        query = query.or(`name.ilike.%${word}%,address.ilike.%${word}%`);
    }
    return query;
}
