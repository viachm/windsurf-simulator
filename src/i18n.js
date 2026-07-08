// Tiny i18n layer: English + Ukrainian.
//
// Two kinds of strings:
//  - Static markup in index.html — tagged with data-i18n / data-i18n-html /
//    data-i18n-title and filled by applyStatic().
//  - Dynamic strings produced by the sim/UI at runtime — the code emits KEYS
//    (e.g. 'warn.nogo') and renders them through t() so they follow the
//    current language every frame.

export const STRINGS = {
  en: {
    'doc.title': 'Windsurf Simulator',
    'lang.toggle': 'УКР',
    'lang.name': 'EN',

    // --- settings ---
    'settings.title': 'SETTINGS',
    'settings.units': 'BOARD SPEED UNITS',
    'settings.windunits': 'WIND SPEED UNITS',
    'settings.lang': 'LANGUAGE',
    'settings.howto': 'HOW TO PLAY',

    // --- HUD ---
    'hud.speed': 'BOARD SPEED',
    'unit.kn': 'kn',
    'unit.kmh': 'km/h',
    'unit.ms': 'm/s',
    'hud.planing': 'PLANING!',
    'hud.pos': 'POINT OF SAIL',
    'hud.wind': 'WIND',
    'hud.gust': 'GUST +{n} {unit}',

    // --- meters ---
    'meter.power': 'SAIL POWER <span id="trim-state"></span>',
    'meter.balance': 'BALANCE <span class="meter-hint">(diamond = your lean, band = what the sail demands)</span>',
    'trim.luff': 'LUFFING',
    'trim.good': 'DRIVING',
    'trim.stall': 'STALLED',

    // --- welcome overlay ---
    'welcome.title': '🏄 WINDSURF SIMULATOR',
    'welcome.intro': 'You are on a board with a sail. The <b>yellow arrow</b> on the compass is the wind. A sail can never drive you straight into it (the shaded <b>no-go wedge</b>) — sail across it.',
    'welcome.step1': '<b>Trim the sail</b> — keep the sheet slider on the green tick (or turn on Auto-trim). Flapping = no power, over-pulled = stall.',
    'welcome.step2': '<b>Steer with the mast</b> — rake forward[[ ◀]] turns you downwind, rake back[[ ▶]] turns you upwind. No rudder!',
    'welcome.step3': '<b>Balance the pull</b> — the harder the sail pulls, the more you must lean windward. Keep the ◆ inside the yellow band or you swim.',
    'welcome.step4': '<b>Chase the plane</b> — enough speed and power and the board pops on top of the water. Then: feet in the straps[[ (3)]], daggerboard up[[ (D)]], hang on.',
    'welcome.goal': 'Try to reach the <span style="color:#ff7043">■ orange buoy upwind</span> (you\'ll need to tack), then blast back to the <span style="color:#ffd54f">■ yellow one</span>.',
    'welcome.close': 'SAIL AWAY →',

    // --- crash overlay ---
    'crash.splash': 'SPLASH!',
    'crash.timer': 'back on the board in {n}…',
    'crash.hold': 'hold to keep reading',
    'crash.release': 'release to sail again →',

    // --- control panel ---
    'panel.header': 'RIG & BODY CONTROLS',
    'ctl.sheet': 'SAIL SHEET <span class="key-hint">W / S</span><span class="ctl-value" id="sheet-val">45°</span>',
    'ctl.sheet.in': 'pulled in (0°)',
    'ctl.sheet.out': 'let out (90°)',
    'ctl.autotrim': 'Auto-trim assist (sheets for you)',

    'ctl.rake': 'MAST RAKE — steering <span class="key-hint">◀ ▶</span>',
    'rake.hardback': '⤒ hard back',
    'rake.hardback.t': 'rake hard back → turn upwind fast',
    'rake.back': 'back',
    'rake.back.t': 'rake back → head upwind',
    'rake.neutral': 'neutral',
    'rake.fwd': 'fwd',
    'rake.fwd.t': 'rake forward → bear away downwind',
    'rake.hardfwd': '⤓ hard fwd',
    'rake.hardfwd.t': 'rake hard forward → turn downwind fast',
    'ctl.rake.up': 'turns you UPWIND →',
    'ctl.rake.down': '← turns you DOWNWIND',

    'ctl.stance': 'FOOT STANCE <span class="key-hint">1 / 2 / 3</span>',
    'stance.front': 'front (by mast)',
    'stance.mid': 'neutral',
    'stance.back': 'back (straps)',

    'ctl.lean': 'WINDWARD LEAN <span class="key-hint">Q / E</span><span class="ctl-value" id="lean-val">25%</span>',
    'ctl.lean.upright': 'upright',
    'ctl.lean.out': 'hiked way out',

    'ctl.dagger': 'Daggerboard down <span class="key-hint">D</span>',
    'ctl.harness': 'Hook into harness <span class="key-hint">H</span>',

    'btn.tack': '⟲ TACK <span class="key-hint">T</span>',
    'btn.tack.t': 'turn the nose through the wind (upwind turn)',
    'btn.gybe': '⟳ GYBE <span class="key-hint">G</span>',
    'btn.gybe.t': 'turn away from the wind through downwind',
    'btn.reset': 'RESET <span class="key-hint">R</span>',

    'ctl.truewind': 'TRUE WIND <span class="ctl-value" id="windset-val">14 kn</span>',
    'help.note': 'drag to orbit the camera · scroll to zoom',

    // --- points of sail ---
    'pos.irons': 'In Irons — No-Go!',
    'pos.close': 'Close-Hauled',
    'pos.beam': 'Beam Reach',
    'pos.broad': 'Broad Reach',
    'pos.run': 'Dead Run',

    // --- tack / maneuvers ---
    'tack.port': 'Port tack',
    'tack.starboard': 'Starboard tack',
    'man.tacking': 'Tacking…',
    'man.gybing': 'Gybing…',

    // --- flash messages (UI interlocks) ---
    'flash.autotrimOff': 'Auto-trim off — you have the boom now.',
    'flash.manual': 'Auto-trim off — you have the controls now.',
    'flash.noBackStraps': 'Not enough speed for the back straps — the tail would sink. Get moving first!',
    'flash.unhookFront': 'Unhooked from the harness — you cannot stay hooked in standing at the mast.',
    'flash.unhookUpright': 'Stood upright — the harness line went slack and unhooked.',
    'flash.noPull': 'No pull in the sail — nothing to hook the harness line onto. Power up first.',
    'flash.hookFromMast': 'Cannot hook in from the mast — step back first[[ (2 or 3)]].',
    'flash.tooDownwind': 'Too far downwind to tack — use GYBE, or head up first (rake back[[ ▶]]).',
    'flash.tackNeedSpeed': 'Need some speed to carry the nose through the wind — power up first.',
    'flash.gybeFromBroad': 'Gybing starts from a broad reach — bear away first (rake forward[[ ◀]]).',
    'flash.tooUpwind': 'Too close to the wind to gybe — use TACK instead.',
    'flash.gybeNeedSpeed': 'Need steerage way to gybe — get some speed first.',
    'main.recovered': 'Back up. Sheet in slowly[[ (W)]] and build speed on a beam reach.',

    // --- coaching warnings (sim) ---
    'warn.tailSink': 'Tail is sinking — move your feet forward until you have speed.',
    'warn.irons': 'In irons! Sheet the sail IN[[ (W)]] to catch the wind — the nose is already falling off; then bear away[[ (◀)]].',
    'warn.overpowered': 'OVERPOWERED! Lean out harder[[ (Q/E)]] or sheet out[[ (S)]] before it launches you!',
    'warn.backfall': 'Sail has no power for that lean — you are falling in backwards!',
    'warn.spinout': 'Daggerboard down at planing speed — the board is railing! Pull it up[[ (D)]]!',
    'warn.pearl': 'Nose is digging in — get your weight back[[ (3)]]!',
    'warn.nogo': 'No-go zone: a sail cannot drive within ~45° of the wind. Bear away (rake forward[[, ◀]]).',
    'warn.luff': 'Sail is flapping (undersheeted) — pull the boom in[[ (W)]].',
    'warn.stall': 'Sail is stalled (oversheeted) — lots of heel, no drive. Let it out[[ (S)]].',
    'warn.getStraps': 'You are planing — get into the footstraps[[ (3)]] to unlock full speed!',
    'warn.almostPlaning': 'Almost planing! Keep the power on and bear away slightly[[ (◀)]].',

    // --- crashes ---
    'crash.catapult.reason': 'CATAPULTED over the handlebars!',
    'crash.catapult.lesson': 'The sail pulled harder than you were leaning against it. Watch the balance meter: keep your diamond inside the yellow band. Sheet out[[ (S)]] or luff up to dump power in gusts.',
    'crash.backfall.reason': 'Fell in backwards!',
    'crash.backfall.lesson': 'You were hiked way out but the sail had no pull to hold you up. Power dies when you oversheet, luff, or point into the no-go zone — ease your lean when the power drops.',
    'crash.spinout.reason': 'SPINOUT — the board railed over!',
    'crash.spinout.lesson': 'At planing speed the daggerboard generates so much lift the board flips onto its rail. Retract the daggerboard[[ (D)]] as soon as you start planing.',
    'crash.pearl.reason': 'PEARLED — nose buried underwater!',
    'crash.pearl.lesson': 'Standing by the mast at speed pushes the nose down until it submarines. Move back to the straps[[ (2, then 3)]] as the board accelerates.',

    // --- guided demo ---
    'demo.btn': 'DEMO',
    'demo.title': 'GUIDED DEMO',
    'demo.intro': 'Sit back — the board sails a teaching route on its own, working every control. Touch anything to take over.',
    'demo.mode.beginner': 'Beginner lesson',
    'demo.mode.beginner.d': 'Every point of sail, a tack and a gybe, narrated step by step.',
    'demo.mode.freeride': 'Freeride',
    'demo.mode.freeride.d': 'Strong wind, planing, footstraps and fast transitions.',
    'demo.mode.chill': 'Chill cruise',
    'demo.mode.chill.d': 'A calm, endless cruise — like a screensaver.',
    'demo.stop': '■ STOP DEMO',
    // beginner tour captions
    'demo.b.beam': 'Beam reach — the wind is straight off your side. The easiest, steadiest course; the board just cruises.',
    'demo.b.headup': 'Heading up — steering the nose closer to the wind. Watch the shaded no-go zone we must stay out of.',
    'demo.b.tack': 'As close to the wind as we can point — time to cross it. Tacking: the nose swings through the eye of the wind.',
    'demo.b.bear': 'New tack. Now we bear away — turning away from the wind onto a broad reach.',
    'demo.b.broad': 'Broad reach — wind from behind the side. The fastest easy course; the board picks up speed.',
    'demo.b.gybe': 'To turn back downwind we swing the tail through the wind — a gybe.',
    'demo.b.settle': 'Back on a beam reach. That is the full loop — every point of sail, both turns.',
    // freeride captions
    'demo.f.power': 'Fresh breeze. Bearing away to load the sail and get the board moving.',
    'demo.f.plane': 'Planing! Feet in the straps, daggerboard up — skimming across the surface.',
    'demo.f.gybe': 'Carving a fast gybe without dropping off the plane.',
    'demo.f.blast': 'Blasting on the broad reach — top speed, fully hooked in.',
    'demo.f.upwind': 'Hard on the wind now — driving upwind on a close reach.',
    'demo.f.tack': 'Snapping a quick tack through the wind.',
    'demo.f.back': 'And straight back onto the plane.',
    // chill captions
    'demo.c.cruise': 'Easy cruise. Sit back and watch the board sail itself.',
    'demo.c.up': 'Drifting gently up toward the wind…',
    'demo.c.down': '…and easing back down off the wind.',
  },

  uk: {
    'doc.title': 'Симулятор віндсерфінгу',
    'lang.toggle': 'ENG',
    'lang.name': 'УКР',

    // --- settings ---
    'settings.title': 'НАЛАШТУВАННЯ',
    'settings.units': 'ОДИНИЦІ ШВИДКОСТІ ДОШКИ',
    'settings.windunits': 'ОДИНИЦІ ШВИДКОСТІ ВІТРУ',
    'settings.lang': 'МОВА',
    'settings.howto': 'ЯК ГРАТИ',

    // --- HUD ---
    'hud.speed': 'ШВИДКІСТЬ ДОШКИ',
    'unit.kn': 'вуз',
    'unit.kmh': 'км/год',
    'unit.ms': 'м/с',
    'hud.planing': 'ГЛІСУВАННЯ!',
    'hud.pos': 'КУРС ДО ВІТРУ',
    'hud.wind': 'ВІТЕР',
    'hud.gust': 'ПОРИВ +{n} {unit}',

    // --- meters ---
    'meter.power': 'ТЯГА ВІТРИЛА <span id="trim-state"></span>',
    'meter.balance': 'БАЛАНС <span class="meter-hint">(ромб = ваш нахил, смуга = чого вимагає вітрило)</span>',
    'trim.luff': 'ПОЛОЩЕ',
    'trim.good': 'ТЯГНЕ',
    'trim.stall': 'ЗРИВ ПОТОКУ',

    // --- welcome overlay ---
    'welcome.title': '🏄 СИМУЛЯТОР ВІНДСЕРФІНГУ',
    'welcome.intro': 'Ви на дошці з вітрилом. <b>Жовта стрілка</b> на компасі — це вітер. Вітрило ніколи не повезе вас прямо проти нього (затінений <b>сектор левентика</b>) — ідіть упоперек.',
    'welcome.step1': '<b>Налаштуйте вітрило</b> — тримайте повзунок шкота на зеленій позначці (або ввімкніть Автоналаштування). Полоще = немає тяги, перебрано = зрив потоку.',
    'welcome.step2': '<b>Стернуйте щоглою</b> — нахил вперед[[ ◀]] уводить під вітер, нахил назад[[ ▶]] приводить до вітру. Стерна немає!',
    'welcome.step3': '<b>Врівноважуйте тягу</b> — що сильніше тягне вітрило, то більше треба нахилятися на вітер. Тримайте ◆ у жовтій смузі, інакше скупаєтесь.',
    'welcome.step4': '<b>Виходьте на глісування</b> — досить швидкості й тяги, і дошка вискакує на поверхню води. Тоді: ноги в петлі[[ (3)]], шверт угору[[ (D)]], тримайтеся.',
    'welcome.goal': 'Спробуйте дістатися <span style="color:#ff7043">■ помаранчевого буя проти вітру</span> (доведеться робити поворот оверштаг), а потім промчати назад до <span style="color:#ffd54f">■ жовтого</span>.',
    'welcome.close': 'У ПЛАВАННЯ →',

    // --- crash overlay ---
    'crash.splash': 'ПЛЮХ!',
    'crash.timer': 'знову на дошці за {n}…',
    'crash.hold': 'тримайте, щоб читати',
    'crash.release': 'відпустіть, щоб продовжити →',

    // --- control panel ---
    'panel.header': 'КЕРУВАННЯ ОСНАЩЕННЯМ І ТІЛОМ',
    'ctl.sheet': 'ШКОТ ВІТРИЛА <span class="key-hint">W / S</span><span class="ctl-value" id="sheet-val">45°</span>',
    'ctl.sheet.in': 'вибрано (0°)',
    'ctl.sheet.out': 'потравлено (90°)',
    'ctl.autotrim': 'Автоналаштування шкота (працює за вас)',

    'ctl.rake': 'НАХИЛ ЩОГЛИ — стернування <span class="key-hint">◀ ▶</span>',
    'rake.hardback': '⤒ різко назад',
    'rake.hardback.t': 'різко нахилити назад → швидко привестися до вітру',
    'rake.back': 'назад',
    'rake.back.t': 'нахил назад → привестися до вітру',
    'rake.neutral': 'нейтрально',
    'rake.fwd': 'вперед',
    'rake.fwd.t': 'нахил вперед → увалитися під вітер',
    'rake.hardfwd': '⤓ різко вперед',
    'rake.hardfwd.t': 'різко нахилити вперед → швидко увалитися під вітер',
    'ctl.rake.up': 'приводить ДО ВІТРУ →',
    'ctl.rake.down': '← уводить ПІД ВІТЕР',

    'ctl.stance': 'ПОЛОЖЕННЯ НІГ <span class="key-hint">1 / 2 / 3</span>',
    'stance.front': 'спереду (біля щогли)',
    'stance.mid': 'нейтрально',
    'stance.back': 'ззаду (петлі)',

    'ctl.lean': 'НАХИЛ НА ВІТЕР <span class="key-hint">Q / E</span><span class="ctl-value" id="lean-val">25%</span>',
    'ctl.lean.upright': 'прямо',
    'ctl.lean.out': 'повний виніс',

    'ctl.dagger': 'Шверт опущено <span class="key-hint">D</span>',
    'ctl.harness': 'Зачепитися в трапецію <span class="key-hint">H</span>',

    'btn.tack': '⟲ ОВЕРШТАГ <span class="key-hint">T</span>',
    'btn.tack.t': 'провести ніс через вітер (поворот проти вітру)',
    'btn.gybe': '⟳ ДЖАЙБ <span class="key-hint">G</span>',
    'btn.gybe.t': 'поворот фордевінд — відвернути від вітру через повний курс',
    'btn.reset': 'СКИНУТИ <span class="key-hint">R</span>',

    'ctl.truewind': 'СПРАВЖНІЙ ВІТЕР <span class="ctl-value" id="windset-val">14 kn</span>',
    'help.note': 'тягніть, щоб обертати камеру · прокрутка — масштаб',

    // --- points of sail ---
    'pos.irons': 'Левентик — не піде!',
    'pos.close': 'Бейдевінд',
    'pos.beam': 'Галфвінд',
    'pos.broad': 'Бакштаг',
    'pos.run': 'Фордевінд',

    // --- tack / maneuvers ---
    'tack.port': 'Лівий галс',
    'tack.starboard': 'Правий галс',
    'man.tacking': 'Поворот оверштаг…',
    'man.gybing': 'Джайб…',

    // --- flash messages (UI interlocks) ---
    'flash.autotrimOff': 'Автоналаштування вимкнено — гік тепер ваш.',
    'flash.manual': 'Автоналаштування вимкнено — керування у ваших руках.',
    'flash.noBackStraps': 'Замало швидкості для задніх петель — корма провалиться. Спершу розженіться!',
    'flash.unhookFront': 'Відчепилися від трапеції — не можна лишатися зачепленим, стоячи біля щогли.',
    'flash.unhookUpright': 'Випросталися — трос трапеції ослаб і від’єднався.',
    'flash.noPull': 'У вітрилі немає тяги — нема за що зачепити трос трапеції. Спершу наберіть тягу.',
    'flash.hookFromMast': 'Не можна зачепитися біля щогли — спершу відступіть назад[[ (2 або 3)]].',
    'flash.tooDownwind': 'Занадто під вітром для оверштагу — робіть ДЖАЙБ або спершу приведіться (нахил назад[[ ▶]]).',
    'flash.tackNeedSpeed': 'Потрібна швидкість, щоб пронести ніс через вітер — спершу наберіть тягу.',
    'flash.gybeFromBroad': 'Джайб починають із бакштагу — спершу увалітеся (нахил вперед[[ ◀]]).',
    'flash.tooUpwind': 'Занадто круто до вітру для джайбу — робіть ОВЕРШТАГ.',
    'flash.gybeNeedSpeed': 'Потрібен хід, щоб зробити джайб — спершу наберіть швидкість.',
    'main.recovered': 'Знову на ногах. Повільно вибирайте шкот[[ (W)]] і набирайте швидкість на галфвінді.',

    // --- coaching warnings (sim) ---
    'warn.tailSink': 'Корма провалюється — пересуньте ноги вперед, доки не наберете швидкість.',
    'warn.irons': 'Ви в левентику! Виберіть шкот[[ (W)]], щоб піймати вітер — ніс уже сходить із вітру; далі увалітеся[[ (◀)]].',
    'warn.overpowered': 'ПЕРЕВАНТАЖЕННЯ! Сильніше виносьтеся[[ (Q/E)]] або травіть шкот[[ (S)]], доки вас не викинуло!',
    'warn.backfall': 'У вітрилі немає тяги для такого нахилу — ви падаєте назад!',
    'warn.spinout': 'Шверт опущено на швидкості глісування — дошку кладе на кант! Підніміть його[[ (D)]]!',
    'warn.pearl': 'Ніс зариває — перенесіть вагу назад[[ (3)]]!',
    'warn.nogo': 'Сектор левентика: вітрило не тягне у межах ~45° від вітру. Увалітеся (нахил вперед[[, ◀]]).',
    'warn.luff': 'Вітрило полоще (шкот недобрано) — вибирайте гік[[ (W)]].',
    'warn.stall': 'Вітрило зі зривом потоку (шкот перебрано) — багато крену, немає тяги. Потравіть[[ (S)]].',
    'warn.getStraps': 'Ви глісуєте — станьте в петлі[[ (3)]], щоб розкрити повну швидкість!',
    'warn.almostPlaning': 'Майже глісуєте! Тримайте тягу й трохи увалітеся[[ (◀)]].',

    // --- crashes ---
    'crash.catapult.reason': 'КАТАПУЛЬТА через гік!',
    'crash.catapult.lesson': 'Вітрило потягло сильніше, ніж ви нахилялися проти нього. Стежте за шкалою балансу: тримайте ромб у жовтій смузі. Травіть шкот[[ (S)]] або приводьтеся, щоб скинути тягу в поривах.',
    'crash.backfall.reason': 'Падіння назад!',
    'crash.backfall.lesson': 'Ви винеслися далеко, та вітрило не мало тяги, щоб вас утримати. Тяга зникає, коли перебираєте шкот, полощете або йдете в сектор левентика — послаблюйте нахил, коли тяга падає.',
    'crash.spinout.reason': 'ЗРИВ КАНТА — дошку поклало!',
    'crash.spinout.lesson': 'На швидкості глісування шверт створює стільки підйомної сили, що дошку перекидає на кант. Прибирайте шверт[[ (D)]], щойно починаєте глісувати.',
    'crash.pearl.reason': 'НІС ПІРНУВ під воду!',
    'crash.pearl.lesson': 'Стійка біля щогли на швидкості вдавлює ніс, доки він не занурюється. Переміщуйтеся назад у петлі[[ (2, потім 3)]], коли дошка розганяється.',

    // --- guided demo ---
    'demo.btn': 'ДЕМО',
    'demo.title': 'ДЕМО-ТУР',
    'demo.intro': 'Відкиньтеся — дошка сама пройде навчальний маршрут і покаже роботу всіх керувань. Торкніться будь-чого, щоб перехопити.',
    'demo.mode.beginner': 'Урок для новачка',
    'demo.mode.beginner.d': 'Усі курси відносно вітру, поворот оверштаг і фордевінд — крок за кроком з поясненнями.',
    'demo.mode.freeride': 'Фрірайд',
    'demo.mode.freeride.d': 'Сильний вітер, глісування, петлі та швидкі повороти.',
    'demo.mode.chill': 'Спокійний круїз',
    'demo.mode.chill.d': 'Спокійне нескінченне катання — наче заставка.',
    'demo.stop': '■ ЗУПИНИТИ ДЕМО',
    // beginner tour captions
    'demo.b.beam': 'Галфвінд — вітер точно збоку. Найлегший і найстабільніший курс; дошка спокійно йде.',
    'demo.b.headup': 'Приводимося — скеровуємо ніс ближче до вітру. Дивіться на затінений сектор левентика, куди йти не можна.',
    'demo.b.tack': 'Гостріше до вітру вже не піти — час перетнути його. Поворот оверштаг: ніс проходить крізь лінію вітру.',
    'demo.b.bear': 'Новий галс. Тепер увалюємося — відвертаємо від вітру на бакштаг.',
    'demo.b.broad': 'Бакштаг — вітер ззаду збоку. Найшвидший простий курс; дошка набирає ходу.',
    'demo.b.gybe': 'Щоб повернути під вітер, проводимо корму крізь вітер — поворот фордевінд.',
    'demo.b.settle': 'Знову галфвінд. Ось і повне коло — усі курси й обидва повороти.',
    // freeride captions
    'demo.f.power': 'Свіжий вітер. Увалюємося, щоб завантажити вітрило й розігнати дошку.',
    'demo.f.plane': 'Глісування! Ноги в петлях, шверт піднято — ковзаємо по поверхні.',
    'demo.f.gybe': 'Ріжемо швидкий фордевінд, не зриваючись із глісування.',
    'demo.f.blast': 'Мчимо на бакштазі — максимальна швидкість, у трапеції.',
    'demo.f.upwind': 'Тепер круто до вітру — рубимося вгору гострим бейдевіндом.',
    'demo.f.tack': 'Різкий поворот оверштаг через вітер.',
    'demo.f.back': 'І одразу знову в глісування.',
    // chill captions
    'demo.c.cruise': 'Спокійне катання. Відкиньтеся й дивіться, як дошка йде сама.',
    'demo.c.up': 'Легко приводимося до вітру…',
    'demo.c.down': '…і плавно увалюємося від вітру.',
  },
};

let lang = 'uk'; // Ukrainian is the default; a saved choice overrides it
try {
  const saved = localStorage.getItem('ws_lang');
  if (saved && STRINGS[saved]) lang = saved;
} catch { /* localStorage may be unavailable */ }

const listeners = new Set();

export function getLang() { return lang; }

export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setLang(l) {
  if (!STRINGS[l] || l === lang) return;
  lang = l;
  try { localStorage.setItem('ws_lang', l); } catch { /* ignore */ }
  applyStatic();
  for (const fn of listeners) fn(l);
}

export function toggleLang() { setLang(lang === 'en' ? 'uk' : 'en'); }

// Keyboard-shortcut hints inside messages are wrapped in [[ ... ]] (leading
// space included). On phones there are no keys, so we drop them; on desktop we
// unwrap them. Static control labels use .key-hint spans (hidden via CSS), not
// these markers, so applyStatic is unaffected.
let compact = false;
try {
  const mq = matchMedia('(max-width: 768px)');
  compact = mq.matches;
  mq.addEventListener('change', (e) => { compact = e.matches; });
} catch { /* matchMedia may be unavailable */ }

function renderHints(s) {
  return compact
    ? s.replace(/\[\[[^\]]*\]\]/g, '').replace(/\s{2,}/g, ' ').trim()
    : s.replace(/\[\[([^\]]*)\]\]/g, '$1');
}

/** Translate a key, substituting {name} placeholders from params. */
export function t(key, params) {
  const table = STRINGS[lang] || STRINGS.en;
  let s = table[key] ?? STRINGS.en[key] ?? key;
  if (params) {
    for (const k in params) s = s.split(`{${k}}`).join(params[k]);
  }
  return renderHints(s);
}

/** Fill all [data-i18n*] elements in the document for the current language. */
export function applyStatic(root = document) {
  document.documentElement.lang = lang;
  document.title = t('doc.title');

  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
}
