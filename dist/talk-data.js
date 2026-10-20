// お話モードの会話データ（事前生成）。
// 頭の動きでパネルを選び、止まったノードの say を音声で読み上げる。
// {呼} は文頭の "{呼}、" のみ。来訪者が選ばれていればその呼び名に置換、未選択なら除去される。
// for: 表示する来訪者 id（father/mother/sister/brother/nurse）。未指定は全員、来訪者未選択時は全表示。
// time: あいさつのみ（morning/day/evening）。children は最大5件、深さは最大4階層。
export const TALK_TREE = [
  { id: "greet", label: "あいさつ", emoji: "👋", children: [
    { id: "greet-morning", label: "おはよう", emoji: "🌅", time: "morning", say: "{呼}、おはよう。", children: [
      { id: "greet-morning-sleep", label: "よく眠れた？", emoji: "😴", say: "{呼}、昨日はよく眠れた？" },
      { id: "greet-morning-today", label: "今日もよろしく", emoji: "🙌", say: "今日もよろしくね。" },
      { id: "greet-morning-early", label: "朝早いね", emoji: "⏰", for: ["father", "mother", "sister", "brother"], say: "{呼}、朝早くから来てくれたんだね。ありがとう。" },
    ]},
    { id: "greet-day", label: "こんにちは", emoji: "☀️", time: "day", say: "{呼}、こんにちは。", children: [
      { id: "greet-day-rest", label: "休めてる？", emoji: "🍵", say: "{呼}、ちゃんと休めてる？" },
      { id: "greet-day-glad", label: "会えてうれしい", emoji: "😊", say: "{呼}、会えてうれしいな。" },
    ]},
    { id: "greet-evening", label: "こんばんは", emoji: "🌙", time: "evening", say: "{呼}、こんばんは。", children: [
      { id: "greet-evening-late", label: "遅くまで", emoji: "🌃", say: "{呼}、こんな時間まで来てくれてありがとね。" },
      { id: "greet-evening-tired", label: "おつかれさま", emoji: "🍀", say: "{呼}、今日もおつかれさま。" },
    ]},
    { id: "greet-visit", label: "来てくれて", emoji: "🤗", say: "{呼}、来てくれてありがとう。", children: [
      { id: "greet-visit-thanks", label: "うれしいな", emoji: "💕", say: "{呼}、来てくれて、すごくうれしいよ。" },
      { id: "greet-visit-long", label: "久しぶり", emoji: "🫶", say: "{呼}、久しぶりだね。", children: [
        { id: "greet-visit-long-miss", label: "会いたかった", emoji: "🥹", say: "{呼}、ずっと会いたかったよ。" },
        { id: "greet-visit-long-change", label: "変わったね？", emoji: "👀", say: "{呼}、なんだか雰囲気変わったね。いい感じだよ。" },
        { id: "greet-visit-long-talk", label: "いっぱい話そ", emoji: "💬", say: "久しぶりだから、いっぱい話そうね。" },
      ]},
      { id: "greet-visit-busy", label: "忙しいのに", emoji: "🙏", say: "忙しいのに来てくれて、ありがとね。" },
      { id: "greet-visit-wait", label: "待ってたよ", emoji: "🕰️", say: "{呼}、待ってたよ。" },
    ]},
    { id: "greet-bye", label: "帰るとき", emoji: "🚪", say: "{呼}、今日はありがとう。", children: [
      { id: "greet-bye-again", label: "またね", emoji: "👋", say: "{呼}、またね。", children: [
        { id: "greet-bye-again-soon", label: "近いうちに", emoji: "📅", say: "また近いうちに来てね。待ってるよ。" },
        { id: "greet-bye-again-tomorrow", label: "明日も来て？", emoji: "🌤️", say: "{呼}、できたら明日もまた来てくれる？" },
        { id: "greet-bye-again-wait", label: "楽しみにね", emoji: "✨", say: "次に来てくれるの、楽しみにしてるね。" },
      ]},
      { id: "greet-bye-care", label: "気をつけて", emoji: "🚗", say: "{呼}、気をつけて帰ってね。", children: [
        { id: "greet-bye-care-road", label: "道に気をつけて", emoji: "🛣️", say: "{呼}、帰り道、本当に気をつけてね。" },
        { id: "greet-bye-care-weather", label: "天気が悪いよ", emoji: "☔", say: "外の天気が悪いかもしれないから、気をつけてね。" },
        { id: "greet-bye-care-sick", label: "風邪ひかないで", emoji: "🧣", say: "{呼}、風邪ひかないようにね。" },
      ]},
      { id: "greet-bye-night", label: "おやすみ", emoji: "🌛", say: "{呼}、おやすみ。", children: [
        { id: "greet-bye-night-sleep", label: "ゆっくり寝てね", emoji: "🛌", say: "{呼}、今夜はゆっくり寝てね。おやすみ。" },
        { id: "greet-bye-night-dream", label: "いい夢を", emoji: "💫", say: "いい夢見てね。おやすみなさい。" },
        { id: "greet-bye-night-tomorrow", label: "また明日", emoji: "🌅", say: "{呼}、また明日ね。おやすみ。" },
      ]},
      { id: "greet-bye-thanks", label: "今日はありがとう", emoji: "🙏", say: "{呼}、今日は一日ありがとね。" },
    ]},
  ]},

  { id: "feel", label: "気持ち", emoji: "💗", children: [
    { id: "feel-thanks", label: "ありがとう", emoji: "🙏", say: "{呼}、ありがとう。", children: [
      { id: "feel-thanks-always", label: "いつも", emoji: "💐", say: "{呼}、いつもありがとね。" },
      { id: "feel-thanks-today", label: "今日のこと", emoji: "🌼", say: "{呼}、今日は来てくれてありがとね。" },
      { id: "feel-thanks-care", label: "お世話して", emoji: "🤝", say: "{呼}、お世話してくれて、本当にありがとう。助かってるよ。" },
      { id: "feel-thanks-laugh", label: "笑わせてくれて", emoji: "😆", say: "{呼}、いつも笑わせてくれてありがとね。" },
    ]},
    { id: "feel-happy", label: "うれしい", emoji: "😄", say: "今、すごくうれしいよ。", children: [
      { id: "feel-happy-see", label: "会えて", emoji: "🥰", say: "{呼}、会えてうれしいな。" },
      { id: "feel-happy-fun", label: "楽しい", emoji: "🎉", say: "今、すごく楽しいよ。", children: [
        { id: "feel-happy-fun-talk", label: "話すのが", emoji: "🗨️", say: "みんなと話してると、楽しいな。" },
        { id: "feel-happy-fun-laugh", label: "笑った", emoji: "🤣", say: "さっきの、ちょっとツボに入っちゃった。笑った。" },
        { id: "feel-happy-fun-day", label: "いい日", emoji: "🌈", say: "今日はなんだか、いい日だね。" },
      ]},
      { id: "feel-happy-good", label: "いい気分", emoji: "😌", say: "今日は気分がいいよ。" },
      { id: "feel-happy-news", label: "いいことが", emoji: "🎁", say: "ちょっといいことがあったんだ。聞いてくれる？" },
    ]},
    { id: "feel-sorry", label: "ごめんね", emoji: "🙇", say: "{呼}、ごめんね。", children: [
      { id: "feel-sorry-worry", label: "心配かけて", emoji: "😢", say: "{呼}、心配かけてごめんね。", children: [
        { id: "feel-sorry-worry-ok", label: "大丈夫だよ", emoji: "👍", say: "でも、私は大丈夫だよ。ゆっくりやっていくからね。" },
        { id: "feel-sorry-worry-thanks", label: "見守ってね", emoji: "🌱", say: "これからも見守ってくれたら、うれしいな。ありがとう。" },
        { id: "feel-sorry-worry-try", label: "がんばるね", emoji: "💪", say: "みんなが安心できるように、少しずつがんばるね。" },
      ]},
      { id: "feel-sorry-trouble", label: "手間かけて", emoji: "🥺", say: "{呼}、いつも手間かけてごめんね。ありがとう。" },
      { id: "feel-sorry-wait", label: "待たせて", emoji: "⏳", say: "{呼}、伝えるのに時間がかかって、ごめんね。待っててくれてありがとう。" },
    ]},
    { id: "feel-down", label: "さみしい・不安", emoji: "🌧️", children: [
      { id: "feel-down-lonely", label: "さみしい", emoji: "🥲", say: "ちょっと、さみしいな。", children: [
        { id: "feel-down-lonely-near", label: "そばにいて", emoji: "🫂", say: "{呼}、そばにいてくれる？" },
        { id: "feel-down-lonely-hand", label: "手を握って", emoji: "🤝", say: "{呼}、そばにいて、手を握ってくれる？" },
        { id: "feel-down-lonely-little", label: "少しだけ", emoji: "🕯️", say: "{呼}、少しだけでいいから、ここにいてくれる？" },
        { id: "feel-down-lonely-talk", label: "話したい", emoji: "💭", say: "{呼}、ちょっとおしゃべりしたい気分なんだ。" },
        { id: "feel-down-lonely-visit", label: "また来てね", emoji: "🏠", for: ["father", "mother", "sister", "brother"], say: "{呼}、また来てくれたらうれしいな。" },
      ]},
      { id: "feel-down-anxious", label: "不安なの", emoji: "😟", say: "ちょっと不安な気持ちなんだ。", children: [
        { id: "feel-down-anxious-listen", label: "話を聞いて", emoji: "👂", say: "{呼}、不安なこと、聞いてくれる？" },
        { id: "feel-down-anxious-night", label: "夜が心配", emoji: "🌌", say: "夜になると、ちょっと不安になるんだ。そばにいてくれると安心するな。" },
        { id: "feel-down-anxious-future", label: "この先のこと", emoji: "🛤️", say: "この先のこと、ちょっと考えちゃう。でも、少しずつ一緒に考えていきたいな。" },
        { id: "feel-down-anxious-calm", label: "落ち着きたい", emoji: "🍃", say: "{呼}、気持ちを落ち着けたいから、静かに隣にいてくれる？" },
      ]},
      { id: "feel-down-bored", label: "ひま・退屈", emoji: "🫠", say: "ちょっと退屈だなあ。何か面白い話して。" },
    ]},
    { id: "feel-body", label: "体の調子", emoji: "🌡️", children: [
      { id: "feel-body-genki", label: "元気だよ", emoji: "😎", say: "今日は元気だよ。", children: [
        { id: "feel-body-genki-good", label: "調子いい", emoji: "✌️", say: "今日はけっこう調子がいいんだ。" },
        { id: "feel-body-genki-better", label: "よくなってる", emoji: "📈", say: "少しずつだけど、よくなってる気がするよ。" },
        { id: "feel-body-genki-sleep", label: "よく寝たよ", emoji: "🛏️", say: "昨日はよく眠れたよ。すっきりしてる。" },
      ]},
      { id: "feel-body-tired", label: "疲れた", emoji: "😮‍💨", say: "ちょっと疲れちゃった。", children: [
        { id: "feel-body-tired-rest", label: "休みたい", emoji: "🛋️", say: "少し休みたいな。" },
        { id: "feel-body-tired-sleep", label: "少し寝るね", emoji: "💤", say: "少し寝るね。また後で話そうね。" },
        { id: "feel-body-tired-later", label: "あとで話そ", emoji: "🕐", say: "ごめんね、あとでゆっくり話してもいい？" },
        { id: "feel-body-tired-quiet", label: "静かにしたい", emoji: "🤫", say: "少し静かに過ごしたいな。そのままそばにいてくれてもいいよ。" },
        { id: "feel-body-tired-pos", label: "体勢を変えて", emoji: "🔄", say: "{呼}、疲れたから、体勢を変えてくれる？" },
      ]},
      { id: "feel-body-sleepy", label: "眠くなった", emoji: "🥱", say: "なんだか眠くなってきちゃった。" },
      { id: "feel-body-hot", label: "暑い・寒い", emoji: "🧊", say: "ちょっと温度が気になるな。", children: [
        { id: "feel-body-hot-hot", label: "暑いかも", emoji: "🥵", say: "{呼}、ちょっと暑いかも。調整してくれる？" },
        { id: "feel-body-hot-cold", label: "寒いかも", emoji: "🥶", say: "{呼}、ちょっと寒いかも。毛布をかけてくれる？" },
      ]},
    ]},
  ]},

  { id: "ask", label: "聞きたい", emoji: "❓", children: [
    { id: "ask-health", label: "体調・元気", emoji: "🩺", say: "{呼}、元気にしてる？", children: [
      { id: "ask-health-how", label: "元気？", emoji: "😊", say: "{呼}、最近、元気にしてる？" },
      { id: "ask-health-sleep", label: "寝れてる？", emoji: "🛌", say: "{呼}、ちゃんと寝れてる？" },
      { id: "ask-health-tired", label: "疲れてない？", emoji: "🥱", say: "{呼}、疲れてない？ 無理しないでね。" },
      { id: "ask-health-father", label: "腰や膝は？", emoji: "🧓", for: ["father"], say: "お父さん、腰や膝の調子はどう？ 無理しないでね。" },
      { id: "ask-health-nurse", label: "私の様子は？", emoji: "📋", for: ["nurse"], say: "看護師さん、今日の私の様子はどうですか？" },
    ]},
    { id: "ask-work", label: "仕事・毎日", emoji: "💼", children: [
      { id: "ask-work-how", label: "仕事どう？", emoji: "🏢", for: ["sister", "brother"], say: "{呼}、仕事はどう？", children: [
        { id: "ask-work-how-busy", label: "忙しい？", emoji: "📚", say: "{呼}、最近は忙しい？" },
        { id: "ask-work-how-fun", label: "楽しい？", emoji: "😄", say: "{呼}、仕事で楽しいことはあった？" },
        { id: "ask-work-how-hard", label: "大変じゃない？", emoji: "🥺", say: "{呼}、大変なことはない？ 話ならいつでも聞くよ。" },
      ]},
      { id: "ask-work-father", label: "最近の楽しみ", emoji: "🌱", for: ["father"], say: "お父さん、最近の楽しみはなに？" },
      { id: "ask-work-rest", label: "休めてる？", emoji: "🍵", say: "{呼}、ちゃんと休めてる？ 無理しないでね。" },
      { id: "ask-work-day", label: "今日はなにを", emoji: "📆", say: "{呼}、今日は一日なにしてたの？" },
      { id: "ask-work-nurse", label: "お仕事は？", emoji: "💉", for: ["nurse"], say: "看護師さん、今日は忙しいですか？ いつもありがとうございます。" },
    ]},
    { id: "ask-meal", label: "ごはん", emoji: "🍚", children: [
      { id: "ask-meal-eaten", label: "食べた？", emoji: "🍽️", say: "{呼}、ごはんはもう食べた？" },
      { id: "ask-meal-what", label: "なに食べた？", emoji: "🍱", say: "{呼}、今日はなに食べたの？ 教えて。" },
      { id: "ask-meal-good", label: "おいしかった？", emoji: "😋", say: "{呼}、それ、おいしかった？" },
      { id: "ask-meal-mother", label: "今日の夕飯", emoji: "🍲", for: ["mother"], say: "お母さん、今日の晩ごはんはなににするの？" },
      { id: "ask-meal-share", label: "あとで教えて", emoji: "📝", say: "おいしいもの食べたら、あとで教えてね。聞くだけでも楽しいから。" },
    ]},
    { id: "ask-life", label: "最近・家のこと", emoji: "🏡", children: [
      { id: "ask-life-recent", label: "最近なにしてる", emoji: "🌟", say: "{呼}、最近どんなことしてるの？", children: [
        { id: "ask-life-recent-fun", label: "楽しいこと", emoji: "🎈", say: "{呼}、最近、楽しかったことはある？" },
        { id: "ask-life-recent-new", label: "新しいこと", emoji: "🆕", say: "{呼}、最近なにか新しく始めたことはある？" },
        { id: "ask-life-recent-busy", label: "忙しい？", emoji: "🌀", say: "{呼}、最近バタバタしてない？" },
      ]},
      { id: "ask-life-family", label: "みんな元気？", emoji: "👨‍👩‍👧‍👦", for: ["father", "mother", "sister", "brother"], say: "{呼}、家のみんなは元気にしてる？", children: [
        { id: "ask-life-family-father", label: "お父さんは？", emoji: "👨", for: ["mother", "sister", "brother"], say: "お父さんは元気にしてる？" },
        { id: "ask-life-family-mother", label: "お母さんは？", emoji: "👩", for: ["father", "sister", "brother"], say: "お母さんは元気にしてる？" },
        { id: "ask-life-family-sister", label: "お姉ちゃんは？", emoji: "👧", for: ["father", "mother", "brother"], say: "お姉ちゃんは元気にしてる？" },
        { id: "ask-life-family-brother", label: "お兄ちゃんは？", emoji: "👦", for: ["father", "mother", "sister"], say: "お兄ちゃんは元気にしてる？" },
      ]},
      { id: "ask-life-funny", label: "面白い話", emoji: "😂", say: "{呼}、なにか面白い話ない？ 聞きたいな。" },
      { id: "ask-life-home", label: "家の様子", emoji: "🏠", say: "{呼}、最近の家の様子、教えてくれる？" },
    ]},
    { id: "ask-out", label: "外・ニュース", emoji: "🌤️", children: [
      { id: "ask-out-weather", label: "今日の天気", emoji: "⛅", say: "{呼}、今日の外の天気はどう？" },
      { id: "ask-out-temp", label: "寒い？暑い？", emoji: "🌡️", say: "外は寒い？ 暑い？ 教えてほしいな。" },
      { id: "ask-out-town", label: "外の様子", emoji: "🏙️", say: "{呼}、外の様子はどんな感じ？ 人は多かった？" },
      { id: "ask-out-news", label: "ニュース", emoji: "📰", say: "{呼}、最近なにかニュースあった？", children: [
        { id: "ask-out-news-big", label: "大きな話題", emoji: "📣", say: "{呼}、最近、大きなニュースはあった？" },
        { id: "ask-out-news-fun", label: "面白い話題", emoji: "🎪", say: "{呼}、なにか面白い話題はあった？" },
        { id: "ask-out-news-anime", label: "アニメの話題", emoji: "📺", say: "{呼}、アニメやマンガの話題、なにか知ってる？" },
      ]},
      { id: "ask-out-season", label: "季節のこと", emoji: "🍂", say: "{呼}、今ごろの季節って、外はどんな景色になってる？" },
    ]},
  ]},

  { id: "otaku", label: "マンガ・アニメ", emoji: "📚", children: [
    { id: "otaku-touken", label: "刀剣乱舞", emoji: "⚔️", say: "{呼}、刀剣乱舞の話しよう。", children: [
      { id: "otaku-touken-oshi", label: "推しは誰？", emoji: "💖", say: "{呼}、刀剣乱舞の推しは誰？", children: [
        { id: "otaku-touken-oshi-mikazuki", label: "三日月宗近", emoji: "🌙", say: "私は三日月宗近が好きなんだ。あの雅な感じがたまらないよね。" },
        { id: "otaku-touken-oshi-kasen", label: "加州清光", emoji: "💅", say: "加州清光が好き。かわいくて、がんばり屋さんなところがいいんだよね。" },
        { id: "otaku-touken-oshi-hasebe", label: "へし切長谷部", emoji: "🧥", say: "へし切長谷部、主命とあらば、って感じがかっこいいよね。" },
        { id: "otaku-touken-oshi-tsuru", label: "鶴丸国永", emoji: "🕊️", say: "鶴丸国永は驚きがあって面白いよね。いたずら好きなところが好き。" },
        { id: "otaku-touken-oshi-yamanba", label: "山姥切国広", emoji: "🧺", say: "山姥切国広、布をかぶってるのに、実はすごくかっこいいんだよね。" },
      ]},
      { id: "otaku-touken-media", label: "舞台・ゲーム", emoji: "🎭", say: "{呼}、刀剣乱舞のミュージカルやゲームの話もしたいな。", children: [
        { id: "otaku-touken-media-musical", label: "ミュージカル", emoji: "🎶", say: "刀ミュ、また観たいな。歌も殺陣もすごいんだよね。" },
        { id: "otaku-touken-media-stage", label: "舞台", emoji: "🎬", say: "刀ステの映像、一緒に観ない？" },
        { id: "otaku-touken-media-anime", label: "アニメ", emoji: "📺", say: "刀剣乱舞のアニメ、一緒に観たいな。" },
        { id: "otaku-touken-media-game", label: "ゲーム", emoji: "🎮", say: "ゲームの刀剣乱舞、今どうなってるのか知りたいな。" },
      ]},
      { id: "otaku-touken-goods", label: "グッズ", emoji: "🎁", say: "{呼}、刀剣乱舞のグッズ、見たいな。", children: [
        { id: "otaku-touken-goods-see", label: "持ってるの", emoji: "🧸", say: "持ってるグッズを、ちょっと見せてくれる？" },
        { id: "otaku-touken-goods-new", label: "新作ある？", emoji: "🆕", say: "新しいグッズが出てないか、調べてくれる？" },
        { id: "otaku-touken-goods-wish", label: "欲しいな", emoji: "🛍️", say: "あのグッズ、欲しいな。買ってきてくれたらうれしいな。" },
      ]},
      { id: "otaku-touken-news", label: "新しい情報", emoji: "🔎", say: "{呼}、刀剣乱舞の新しい情報、調べてくれる？", children: [
        { id: "otaku-touken-news-search", label: "調べて", emoji: "📱", say: "刀剣乱舞の最新情報を、スマホで調べてほしいな。" },
        { id: "otaku-touken-news-event", label: "イベント", emoji: "🎪", say: "刀剣乱舞のイベントや展示が、近くであるか調べてくれる？" },
        { id: "otaku-touken-news-new", label: "新キャラ", emoji: "🌸", say: "新しい刀剣男士が来てないか、気になるんだ。" },
      ]},
      { id: "otaku-touken-talk", label: "語りたい", emoji: "🔥", say: "{呼}、刀剣乱舞について、ちょっと語ってもいい？" },
    ]},
    { id: "otaku-ghibli", label: "ジブリ", emoji: "🌳", say: "{呼}、ジブリの話しよう。", children: [
      { id: "otaku-ghibli-watch", label: "見たい", emoji: "📺", say: "ジブリが見たいな。", children: [
        { id: "otaku-ghibli-watch-totoro", label: "トトロ", emoji: "🌰", say: "となりのトトロが見たいな。" },
        { id: "otaku-ghibli-watch-chihiro", label: "千と千尋", emoji: "🏮", say: "千と千尋の神隠しが見たいな。" },
        { id: "otaku-ghibli-watch-laputa", label: "ラピュタ", emoji: "🏰", say: "天空の城ラピュタが見たいな。" },
        { id: "otaku-ghibli-watch-kiki", label: "魔女の宅急便", emoji: "🧹", say: "魔女の宅急便が見たいな。" },
        { id: "otaku-ghibli-watch-mononoke", label: "もののけ姫", emoji: "🐺", say: "もののけ姫が見たいな。" },
      ]},
      { id: "otaku-ghibli-fav", label: "どれが好き？", emoji: "💚", say: "{呼}、ジブリでどれが一番好き？", children: [
        { id: "otaku-ghibli-fav-howl", label: "ハウル", emoji: "🔥", say: "ハウルの動く城、好きなんだよね。" },
        { id: "otaku-ghibli-fav-nausicaa", label: "ナウシカ", emoji: "🪲", say: "風の谷のナウシカ、何回見てもいいよね。" },
        { id: "otaku-ghibli-fav-porco", label: "紅の豚", emoji: "🐷", say: "紅の豚、かっこいいよね。飛ばねえ豚はただの豚だ、ってね。" },
        { id: "otaku-ghibli-fav-mimi", label: "耳をすませば", emoji: "🎻", say: "耳をすませば、青春って感じでいいよね。" },
        { id: "otaku-ghibli-fav-ponyo", label: "ポニョ", emoji: "🐟", say: "崖の上のポニョ、かわいくて好き。" },
      ]},
      { id: "otaku-ghibli-music", label: "ジブリの曲", emoji: "🎵", say: "{呼}、ジブリの曲をかけてくれる？", children: [
        { id: "otaku-ghibli-music-sanpo", label: "さんぽ", emoji: "🚶", say: "トトロの「さんぽ」をかけてくれる？" },
        { id: "otaku-ghibli-music-kimi", label: "君をのせて", emoji: "🎶", say: "ラピュタの「君をのせて」をかけてくれる？" },
        { id: "otaku-ghibli-music-itsumo", label: "いつも何度でも", emoji: "🌊", say: "千と千尋の「いつも何度でも」をかけてくれる？" },
        { id: "otaku-ghibli-music-hisaishi", label: "サントラ", emoji: "🎹", say: "久石譲の曲、聴いてるとなんだか泣きそうになるんだ。" },
      ]},
      { id: "otaku-ghibli-talk", label: "語りたい", emoji: "💬", say: "{呼}、ジブリのこと語ってもいい？", children: [
        { id: "otaku-ghibli-talk-food", label: "ジブリ飯", emoji: "🍳", say: "ジブリに出てくるごはん、どれもおいしそうだよね。どれが好き？" },
        { id: "otaku-ghibli-talk-line", label: "名セリフ", emoji: "🗯️", say: "ジブリの名セリフ、言い合いっこしようよ。" },
        { id: "otaku-ghibli-talk-scene", label: "好きな場面", emoji: "🎬", say: "{呼}、ジブリでいちばん好きな場面ってどこ？" },
        { id: "otaku-ghibli-talk-park", label: "ジブリパーク", emoji: "🎡", say: "ジブリパーク、いつか行ってみたいな。写真見せてくれる？" },
      ]},
      { id: "otaku-ghibli-together", label: "一緒に見よう", emoji: "🛋️", say: "{呼}、ジブリ一緒に見ようよ。", children: [
        { id: "otaku-ghibli-together-now", label: "今から", emoji: "▶️", say: "{呼}、今から一緒にジブリ見ない？" },
        { id: "otaku-ghibli-together-kinro", label: "金曜ロードショー", emoji: "📡", say: "今度の金曜ロードショー、ジブリやるか調べてくれる？" },
        { id: "otaku-ghibli-together-old", label: "昔みんなで", emoji: "👨‍👩‍👧‍👦", say: "昔、家族みんなでジブリ見たよね。なつかしいな。" },
      ]},
    ]},
    { id: "otaku-manga", label: "マンガ", emoji: "📖", say: "{呼}、マンガの話しようよ。", children: [
      { id: "otaku-manga-read", label: "続き読んで", emoji: "🗣️", say: "{呼}、マンガの続き、読んでくれる？", children: [
        { id: "otaku-manga-read-next", label: "続きから", emoji: "▶️", say: "昨日の続きから、読んでくれる？" },
        { id: "otaku-manga-read-recap", label: "あらすじ", emoji: "📝", say: "前の話、ちょっと忘れちゃった。あらすじを教えてくれる？" },
        { id: "otaku-manga-read-aloud", label: "声に出して", emoji: "🎙️", say: "声に出して読んでほしいな。役になりきっても、いいよ。" },
      ]},
      { id: "otaku-manga-new", label: "新刊は？", emoji: "🆕", say: "{呼}、好きなマンガの新刊、出てるかな？", children: [
        { id: "otaku-manga-new-check", label: "出てる？", emoji: "📚", say: "新刊が出てるか、調べてくれる？" },
        { id: "otaku-manga-new-tell", label: "出たら教えて", emoji: "🔔", say: "新刊が出たら、教えてね。" },
        { id: "otaku-manga-new-wait", label: "待ちきれない", emoji: "⏱️", say: "続きが気になって、待ちきれないんだ。" },
      ]},
      { id: "otaku-manga-buy", label: "買ってきて", emoji: "🛒", say: "{呼}、マンガを買ってきてほしいな。", children: [
        { id: "otaku-manga-buy-bring", label: "これお願い", emoji: "🙏", say: "今度、マンガを買ってきてくれる？ 題名はあとで伝えるね。" },
        { id: "otaku-manga-buy-vol", label: "何巻まで", emoji: "🔢", say: "何巻まで持ってるか、確認してくれる？" },
        { id: "otaku-manga-buy-net", label: "ネットで注文", emoji: "💻", say: "ネットで注文してくれたら、助かるな。" },
      ]},
      { id: "otaku-manga-page", label: "ページ操作", emoji: "📄", say: "{呼}、ページをめくってくれる？", children: [
        { id: "otaku-manga-page-turn", label: "めくって", emoji: "➡️", say: "{呼}、次のページをめくってくれる？" },
        { id: "otaku-manga-page-back", label: "前に戻って", emoji: "⬅️", say: "ごめん、ひとつ前のページに戻ってくれる？" },
        { id: "otaku-manga-page-wait", label: "まだ読んでる", emoji: "👁️", say: "まだ読んでるから、もうちょっと待ってね。" },
      ]},
    ]},
    { id: "otaku-anime", label: "アニメ", emoji: "📺", say: "{呼}、アニメの話しようよ。", children: [
      { id: "otaku-anime-watch", label: "見たい", emoji: "👀", say: "アニメが見たい気分なんだ。", children: [
        { id: "otaku-anime-watch-new", label: "新作を", emoji: "🆕", say: "新しく始まったアニメが見たいな。" },
        { id: "otaku-anime-watch-again", label: "もう一度", emoji: "🔁", say: "好きなアニメを、もう一度見たい気分なんだ。" },
        { id: "otaku-anime-watch-touken", label: "刀剣乱舞", emoji: "⚔️", say: "刀剣乱舞のアニメが見たいな。つけてくれる？" },
      ]},
      { id: "otaku-anime-together", label: "一緒に見よう", emoji: "🍿", say: "{呼}、一緒にアニメ見ようよ。", children: [
        { id: "otaku-anime-together-now", label: "今から", emoji: "▶️", say: "{呼}、今から一緒に見ない？" },
        { id: "otaku-anime-together-next", label: "次に来たら", emoji: "📅", say: "次に来たとき、一緒に見ようね。" },
        { id: "otaku-anime-together-talk", label: "感想会しよ", emoji: "🗨️", say: "見終わったら、感想会しようね。語りたいことたくさんあるんだ。" },
      ]},
      { id: "otaku-anime-ep", label: "何話から？", emoji: "🔢", say: "{呼}、何話から見るか決めたいな。", children: [
        { id: "otaku-anime-ep-last", label: "前の続き", emoji: "⏭️", say: "前に見たところの続きからお願い。" },
        { id: "otaku-anime-ep-first", label: "第1話から", emoji: "1️⃣", say: "最初の第1話から、見直したいな。" },
        { id: "otaku-anime-ep-pick", label: "選んで", emoji: "🎲", say: "好きな回を選んで、見せてくれる？" },
      ]},
      { id: "otaku-anime-vol", label: "音・画面", emoji: "🔊", say: "{呼}、アニメの音や画面を調整してくれる？", children: [
        { id: "otaku-anime-vol-up", label: "音を大きく", emoji: "🔉", say: "{呼}、音をちょっと大きくしてくれる？" },
        { id: "otaku-anime-vol-down", label: "音を小さく", emoji: "🔈", say: "{呼}、音をちょっと小さくしてくれる？" },
        { id: "otaku-anime-vol-view", label: "画面の向き", emoji: "🖥️", say: "{呼}、画面を見やすい位置に動かしてくれる？" },
      ]},
    ]},
    { id: "otaku-rec", label: "推し・おすすめ", emoji: "⭐", children: [
      { id: "otaku-rec-ask", label: "教えて", emoji: "🙋", say: "{呼}、おすすめのマンガかアニメ、教えてくれる？" },
      { id: "otaku-rec-tell", label: "すすめたい", emoji: "📢", say: "すすめたい作品があるんだ。", children: [
        { id: "otaku-rec-tell-manga", label: "このマンガ", emoji: "📕", say: "読んでほしいマンガがあるんだ。題名はあとで伝えるね。" },
        { id: "otaku-rec-tell-anime", label: "このアニメ", emoji: "🎞️", say: "見てほしいアニメがあるんだ。一緒に見よう。" },
      ]},
      { id: "otaku-rec-genre", label: "ジャンル", emoji: "🎯", say: "今日はどんなジャンルの気分かな。", children: [
        { id: "otaku-rec-genre-fun", label: "笑えるの", emoji: "🤣", say: "今日は、笑えるやつがいいな。" },
        { id: "otaku-rec-genre-cry", label: "泣けるの", emoji: "😭", say: "思いっきり泣けるやつも、たまにはいいよね。" },
        { id: "otaku-rec-genre-action", label: "熱いバトル", emoji: "🔥", say: "今日は、熱いバトルものが見たいな。" },
      ]},
      { id: "otaku-rec-visitor", label: "好きなのは？", emoji: "💡", say: "どんなマンガやアニメが好き？" },
      { id: "otaku-rec-oshi", label: "推し語り", emoji: "💘", say: "{呼}、推しの話、聞いてくれる？", children: [
        { id: "otaku-rec-oshi-love", label: "好きすぎる", emoji: "😍", say: "好きすぎて困っちゃう。もう生活の一部だよ。" },
        { id: "otaku-rec-oshi-cry", label: "尊い", emoji: "🥹", say: "あのシーン、尊すぎて何回見ても泣いちゃうんだ。" },
        { id: "otaku-rec-oshi-pull", label: "沼に誘う", emoji: "🌀", say: "そろそろ、こっちの沼に来ない？ 楽しいよ。" },
        { id: "otaku-rec-oshi-scene", label: "名シーン", emoji: "🎬", say: "{呼}、私のいちばん好きな名シーンの話、してもいい？" },
      ]},
    ]},
  ]},

  { id: "memory", label: "思い出・家族", emoji: "📷", children: [
    { id: "memory-child", label: "子どものころ", emoji: "🧒", for: ["father", "mother", "sister", "brother"], say: "{呼}、子どものころの話しようよ。", children: [
      { id: "memory-child-play", label: "よく遊んだね", emoji: "🛝", say: "{呼}、子どものころ、よく遊んだよね。" },
      { id: "memory-child-school", label: "学校の思い出", emoji: "🎒", say: "{呼}、学校のころのこと、覚えてる？" },
      { id: "memory-child-funny", label: "おかしな話", emoji: "🤭", say: "子どものころの、おかしな話を思い出したよ。", children: [
        { id: "memory-child-funny-laugh", label: "笑った話", emoji: "😂", say: "{呼}、昔みんなで大笑いしたこと、覚えてる？" },
        { id: "memory-child-funny-scold", label: "怒られた話", emoji: "😅", say: "{呼}、昔、みんなで怒られたこともあったよね。" },
        { id: "memory-child-funny-secret", label: "ひみつの話", emoji: "🤫", say: "{呼}、実は昔こっそりやってたことがあるんだ。内緒だよ。" },
      ]},
      { id: "memory-child-snack", label: "おやつの味", emoji: "🍪", say: "子どものころのおやつ、なつかしいなあ。覚えてる？" },
    ]},
    { id: "memory-trip", label: "家族旅行", emoji: "🧳", for: ["father", "mother", "sister", "brother"], say: "{呼}、家族で行った旅行の話しようよ。", children: [
      { id: "memory-trip-where", label: "どこ行った？", emoji: "🗺️", say: "{呼}、あのとき、どこに行ったんだっけ？" },
      { id: "memory-trip-fun", label: "楽しかった", emoji: "🎡", say: "家族みんなで行った旅行、楽しかったね。" },
      { id: "memory-trip-again", label: "また行きたい", emoji: "🚃", say: "また、みんなでどこか行きたいな。", children: [
        { id: "memory-trip-again-onsen", label: "温泉がいい", emoji: "♨️", say: "温泉もいいな。みんなでのんびりしたいね。" },
        { id: "memory-trip-again-sea", label: "海が見たい", emoji: "🌊", say: "海が見たいな。写真や動画でもいいから、見せてくれる？" },
        { id: "memory-trip-again-near", label: "近場でもいい", emoji: "🚙", say: "近場でも、みんなでお出かけできたら、うれしいな。" },
      ]},
      { id: "memory-trip-photo", label: "旅行の写真", emoji: "🖼️", say: "旅行の写真が見たいな。持ってきてくれる？" },
      { id: "memory-trip-fail", label: "失敗談", emoji: "🙈", say: "旅行のときの失敗談、あったよね。思い出して笑っちゃう。" },
    ]},
    { id: "memory-photo", label: "昔の写真", emoji: "🖼️", say: "{呼}、昔の写真が見たいな。", children: [
      { id: "memory-photo-see", label: "見たい", emoji: "👀", say: "家族の昔の写真が見たいな。" },
      { id: "memory-photo-album", label: "アルバム", emoji: "📔", say: "{呼}、今度アルバムを持ってきてくれる？" },
      { id: "memory-photo-phone", label: "スマホの写真", emoji: "📱", say: "スマホにある写真、見せてくれる？" },
      { id: "memory-photo-share", label: "一緒に見よう", emoji: "🧑‍🤝‍🧑", say: "{呼}、写真を一緒に見ながら、思い出話しようよ。", children: [
        { id: "memory-photo-share-now", label: "今見たい", emoji: "⚡", say: "{呼}、今ここで、一緒に写真を見ない？" },
        { id: "memory-photo-share-tell", label: "説明して", emoji: "🗣️", say: "{呼}、写真に写ってるの、いつのことか教えてくれる？" },
        { id: "memory-photo-share-young", label: "若いね", emoji: "🤣", say: "みんな若いね。この髪型、なつかしくて笑っちゃうな。" },
      ]},
    ]},
    { id: "memory-home", label: "実家・昔の家", emoji: "🏠", children: [
      { id: "memory-home-old", label: "昔の家", emoji: "🏡", for: ["father", "mother", "sister", "brother"], say: "{呼}、昔の家のこと、思い出すなあ。" },
      { id: "memory-home-room", label: "自分の部屋", emoji: "🛏️", say: "子どものころの自分の部屋、なつかしいな。" },
      { id: "memory-home-town", label: "町の景色", emoji: "🏘️", say: "{呼}、住んでた町の景色、今はどうなってるのかな。" },
      { id: "memory-home-mother", label: "母の料理", emoji: "🍳", say: "お母さんの料理の思い出、話してもいい？", children: [
        { id: "memory-home-mother-taste", label: "なつかしい味", emoji: "😋", say: "お母さんの料理、なつかしい味がいっぱいあるよね。" },
        { id: "memory-home-mother-recipe", label: "作り方聞いて", emoji: "📒", for: ["father", "sister", "brother"], say: "{呼}、あの料理の作り方、お母さんに聞いておいてくれる？" },
        { id: "memory-home-mother-smell", label: "台所の匂い", emoji: "🍲", say: "台所から、いい匂いがしてたのを思い出すよ。" },
      ]},
      { id: "memory-home-father", label: "父の思い出", emoji: "🧓", say: "お父さんとの思い出も、たくさんあるよね。" },
    ]},
    { id: "memory-gather", label: "みんなで", emoji: "🎊", for: ["father", "mother", "sister", "brother"], children: [
      { id: "memory-gather-all", label: "集まりたい", emoji: "👨‍👩‍👧‍👦", say: "{呼}、またみんなで集まりたいな。" },
      { id: "memory-gather-when", label: "いつ会える？", emoji: "📅", say: "{呼}、次はみんな、いつ会えそうかな？" },
      { id: "memory-gather-video", label: "ビデオ通話", emoji: "📹", say: "みんなが集まれないときは、ビデオ通話でもいいね。" },
      { id: "memory-gather-talk", label: "昔話しよう", emoji: "🍵", say: "みんなでゆっくり、昔話でもしようよ。" },
      { id: "memory-gather-photo", label: "集合写真", emoji: "📸", say: "みんなで集合写真、撮りたいな。" },
    ]},
  ]},

  { id: "wish", label: "お願い・相談", emoji: "🙏", children: [
    { id: "wish-bring", label: "持ってきて", emoji: "🎒", say: "{呼}、お願いがあるんだけど、いいかな？", children: [
      { id: "wish-bring-photo", label: "写真", emoji: "🖼️", say: "{呼}、今度、家族の写真を持ってきてくれる？" },
      { id: "wish-bring-manga", label: "マンガ", emoji: "📚", say: "{呼}、今度、マンガを持ってきてくれる？", children: [
        { id: "wish-bring-manga-series", label: "続きの巻", emoji: "🔖", say: "読んでるマンガの、続きの巻を持ってきてくれる？" },
        { id: "wish-bring-manga-new", label: "新刊", emoji: "🆕", say: "新刊が出てたら、持ってきてくれるとうれしいな。" },
        { id: "wish-bring-manga-fav", label: "お気に入り", emoji: "💝", say: "お気に入りのマンガを、また読み返したいな。持ってきてくれる？" },
      ]},
      { id: "wish-bring-goods", label: "グッズ", emoji: "🧸", say: "{呼}、好きなグッズを持ってきてくれる？", children: [
        { id: "wish-bring-goods-touken", label: "刀剣乱舞の", emoji: "⚔️", say: "刀剣乱舞のグッズを、持ってきてくれる？" },
        { id: "wish-bring-goods-show", label: "見せてほしい", emoji: "👀", say: "持ってきたグッズを、顔の近くで見せてくれる？" },
        { id: "wish-bring-goods-place", label: "近くに置いて", emoji: "🛏️", say: "好きなグッズを、見えるところに置いてくれる？" },
      ]},
      { id: "wish-bring-clothes", label: "服・小物", emoji: "🧦", say: "{呼}、あったかい服や小物を、持ってきてくれる？" },
      { id: "wish-bring-flower", label: "お花", emoji: "🌷", say: "{呼}、お花を飾ってくれたら、うれしいな。" },
    ]},
    { id: "wish-search", label: "調べて", emoji: "🔎", say: "{呼}、ちょっと調べてほしいことがあるんだ。", children: [
      { id: "wish-search-touken", label: "刀剣乱舞", emoji: "⚔️", say: "刀剣乱舞のこと、調べてくれる？" },
      { id: "wish-search-news", label: "ニュース", emoji: "📰", say: "今日のニュースを、調べて教えてくれる？" },
      { id: "wish-search-weather", label: "天気予報", emoji: "🌦️", say: "明日の天気、調べてくれる？" },
      { id: "wish-search-song", label: "音楽をかけて", emoji: "🎵", say: "好きな曲をかけてくれる？ 聞きながらのんびりしたいな。" },
      { id: "wish-search-video", label: "動画を見たい", emoji: "▶️", say: "{呼}、面白そうな動画を探して、見せてくれる？" },
    ]},
    { id: "wish-contact", label: "連絡して", emoji: "📞", say: "{呼}、連絡してほしい人がいるんだ。", children: [
      { id: "wish-contact-friend", label: "友だちに", emoji: "👭", say: "友だちに連絡してくれる？", children: [
        { id: "wish-contact-friend-hi", label: "元気だよと", emoji: "💌", say: "友だちに、元気にしてるよって伝えてくれる？" },
        { id: "wish-contact-friend-visit", label: "会いたいと", emoji: "🫶", say: "友だちに、また会えたらうれしいって伝えてくれる？" },
        { id: "wish-contact-friend-reply", label: "返信して", emoji: "✉️", say: "友だちからの返事、読んでくれる？ 返信もお願いしたいな。" },
      ]},
      { id: "wish-contact-family", label: "家族に", emoji: "🏠", say: "家族のみんなに、連絡してくれる？" },
      { id: "wish-contact-call", label: "電話したい", emoji: "☎️", say: "{呼}、誰かと電話をつないでくれる？" },
      { id: "wish-contact-read", label: "メッセージ", emoji: "💬", say: "届いてるメッセージを、読んでくれる？" },
      { id: "wish-contact-send", label: "写真を送って", emoji: "📤", say: "{呼}、今日の写真を、みんなに送ってくれる？" },
    ]},
    { id: "wish-near", label: "そばで", emoji: "🫂", children: [
      { id: "wish-near-window", label: "窓の外", emoji: "🪟", say: "窓の外が見たいな。", children: [
        { id: "wish-near-window-open", label: "カーテン開けて", emoji: "🌅", say: "{呼}、カーテンを開けてくれる？" },
        { id: "wish-near-window-see", label: "景色を見せて", emoji: "🌳", say: "{呼}、窓のそばで外の景色を見せてくれる？" },
        { id: "wish-near-window-bright", label: "明るさ調整", emoji: "💡", say: "ちょっとまぶしいから、明るさを調整してくれる？" },
      ]},
      { id: "wish-near-hand", label: "手を握って", emoji: "🤝", say: "{呼}、手を握ってくれる？" },
      { id: "wish-near-with", label: "一緒にいて", emoji: "🧸", say: "{呼}、しばらく一緒にいてくれる？" },
      { id: "wish-near-listen", label: "話を聞いて", emoji: "👂", say: "{呼}、ちょっと話を聞いてくれる？" },
      { id: "wish-near-photo", label: "写真撮って", emoji: "📸", say: "{呼}、写真を撮ってくれる？", children: [
        { id: "wish-near-photo-together", label: "一緒に", emoji: "🤳", say: "{呼}、一緒に写真を撮ろうよ。" },
        { id: "wish-near-photo-me", label: "私を撮って", emoji: "😊", say: "今日は調子がいいから、私の写真を撮ってくれる？" },
        { id: "wish-near-photo-send", label: "送ってね", emoji: "📲", say: "撮った写真は、あとで送ってね。" },
      ]},
    ]},
    { id: "wish-care", label: "体のこと", emoji: "🛟", children: [
      { id: "wish-care-pos", label: "体勢を変えて", emoji: "🔄", say: "{呼}、体勢を変えてほしいな。" },
      { id: "wish-care-temp", label: "温度を調整", emoji: "🌡️", say: "{呼}、部屋の温度を調整してくれる？" },
      { id: "wish-care-itch", label: "かゆい", emoji: "😣", say: "{呼}、ちょっとかゆいところがあるから、見てくれる？" },
      { id: "wish-care-suction", label: "痰が気になる", emoji: "🩺", for: ["father", "mother", "sister", "brother"], say: "{呼}、痰が気になるから、看護師さんを呼んでくれる？" },
      { id: "wish-care-suction-nurse", label: "痰を取って", emoji: "🩺", for: ["nurse"], say: "看護師さん、痰を吸引してもらえますか？" },
    ]},
  ]},
];
