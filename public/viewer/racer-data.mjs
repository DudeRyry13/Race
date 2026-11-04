// Character identities, editable paddock stories and actual driving profiles.
export const RACERS=[
  {id:'mensari',name:'Менсарий',tag:'Золотая середина',color:'#78eaff',description:'Ровный темп, предсказуемый разгон и удобное управление.',
    tuning:{maxSpeed:42,boostSpeed:59,acceleration:22,boostAcceleration:33,lateralGrip:34,driftGrip:80,handling:1,driftChargeRate:1,miniTurbo:1,mass:1},
    lore:'Менсарий услышал, что за победу дают кубок, и решил, что это большая монета. Теперь считает круги доходом, а каждый занос — необлагаемым расходом. Бухгалтерию ведёт на руле.'},
  {id:'monster',name:'Аскитрея',tag:'Пончик на максималках',color:'#ffac76',description:'Самая высокая скорость на прямой. Разгон и цепкость требуют терпения.',
    tuning:{maxSpeed:46,boostSpeed:63,acceleration:19,boostAcceleration:29,lateralGrip:30,driftGrip:74,handling:.93,driftChargeRate:.90,miniTurbo:.95,mass:1.02},
    lore:'Аскитрея заказала пончик «с собой» и восприняла это как инструкцию по сборке транспорта. Пожарные считают её угрозой, кондитеры — прорывом. Перед стартом она обязательно проверяет давление глазури.'},
  {id:'se1t',name:'Сеттрих',tag:'Наковальня с разгоном',color:'#ff8dba',description:'Тяжёлый карт бодро разгоняется и уверенно толкается, но уступает на прямой.',
    tuning:{maxSpeed:40,boostSpeed:56,acceleration:27,boostAcceleration:39,lateralGrip:38,driftGrip:78,handling:.94,driftChargeRate:.95,miniTurbo:1,mass:1.30},
    lore:'Сеттрих выковал машину из наковальни, потому что нормальную наковальню уже заняли под машину. На пит-стопе чинит всё молотком, включая расписание. Финишную черту обещает перековать в стартовую.'},
  {id:'textured_00002',name:'Аделаида',tag:'Призрак поворотов',color:'#c2ff88',description:'Цепкий дрифт, быстрый заряд заноса и длинное мини-турбо.',
    tuning:{maxSpeed:41,boostSpeed:58,acceleration:23,boostAcceleration:34,lateralGrip:36,driftGrip:96,handling:1.10,driftChargeRate:1.25,miniTurbo:1.15,mass:.93},
    lore:'Аделаида наняла призрака водителем, но тот испугался ремня безопасности. Пришлось сесть за руль самой. Теперь она кричит «БУ!» на каждом апексе и пугается собственного эха в шлеме.'},
  {id:'textured_00004',name:'Фалька',tag:'Лисий манёвр',color:'#c4adff',description:'Быстрый разгон и послушный дрифт. Хороша для обгонов между машинами.',
    tuning:{maxSpeed:43,boostSpeed:60,acceleration:24,boostAcceleration:35,lateralGrip:34,driftGrip:90,handling:1.06,driftChargeRate:1.15,miniTurbo:1.08,mass:.96},
    lore:'Фалька уверена, что лиса — это редкая модель двигателя. Лиса уверена, что Фалька — это багаж. Они нашли компромисс: хвост отвечает за аэродинамику, а все штрафы приходят кепке.'},
  {id:'haakon',name:'Хаакон',tag:'Побег со старта',color:'#ffb2a3',description:'Резко стартует и хорошо ускоряется под турбо. В заносе нужна аккуратность.',
    tuning:{maxSpeed:43.5,boostSpeed:61,acceleration:26,boostAcceleration:38,lateralGrip:31.5,driftGrip:77,handling:1.03,driftChargeRate:.95,miniTurbo:.98,mass:1.04},
    lore:'Хаакон сбежал из автошколы вместе с учебным конусом. Маячок включил, чтобы все видели, как хорошо он прячется. Полосатый костюм, по его словам, добавляет машине пять скоростей и одну условную.'},
  {id:'leona',name:'Леона',tag:'Алый крейсер',color:'#ffb36e',description:'Быстрый тяжёлый крейсер для прямых. Разгон спокойнее, чем у лёгких картов.',
    tuning:{maxSpeed:45,boostSpeed:63.5,acceleration:20,boostAcceleration:31,lateralGrip:35,driftGrip:82,handling:.96,driftChargeRate:1,miniTurbo:1,mass:1.17},
    lore:'Леона объявила парковку своим флотом и назначила себя адмиралом третьего бордюра. На любом повороте командует «Право руля!», даже если поворот левый. Якорь сняла: он портил время круга и асфальт.'},
  {id:'mara',name:'Мара',tag:'Кошачий дрифт',color:'#d5c9ff',description:'Самый цепкий занос и быстрый заряд мини-турбо. Максимальная скорость скромнее.',
    tuning:{maxSpeed:40.5,boostSpeed:57.5,acceleration:25,boostAcceleration:36,lateralGrip:39,driftGrip:101,handling:1.14,driftChargeRate:1.32,miniTurbo:1.20,mass:.94},
    lore:'Мара три дня объясняла коту гоночную траекторию. Кот три дня смотрел в стену и всё равно прошёл квалификацию. После проигрыша они молча осуждают весь автоспорт, особенно левый поворот.'},
  {id:'geekaton',name:'Гекатон',tag:'Алхимия турбо',color:'#d59aff',description:'Сильное турбо и уверенная скорость. Обычный разгон без особой спешки.',
    tuning:{maxSpeed:44,boostSpeed:62.5,acceleration:21,boostAcceleration:37,lateralGrip:33,driftGrip:85,handling:1,driftChargeRate:1.07,miniTurbo:1.15,mass:1.08},
    lore:'Гекатон сварил зелье скорости, но по ошибке получил фиолетовый компот. Машина едет, поэтому рецепт признан удачным. Перед каждым заездом он грозно смотрит на колбу, чтобы та не расслаблялась.'},
];
export const RACER_BY_ID=Object.fromEntries(RACERS.map(r=>[r.id,r]));
const rating=(value,low,high)=>Math.max(1,Math.min(5,Math.round((1+4*(value-low)/(high-low))*10)/10));
export function racerDisplayStats(hero){
  const t=hero.tuning;
  return {speed:Math.round(t.maxSpeed*3.6),boost:Math.round(t.boostSpeed*3.6),speedRating:rating(t.maxSpeed,40,46),
    accelerationRating:rating(t.acceleration,19,27),driftRating:rating(t.driftGrip*t.driftChargeRate,66,134)};
}
