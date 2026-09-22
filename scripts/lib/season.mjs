// DURU KOREAN — what is on people's minds in Korea this month
//
// The generator has no web search. This is what stands in for it,
// together with the gap analysis in topics.mjs: a calendar of what is
// actually happening in Korea, and the questions foreigners really ask.
//
// Nothing here asserts a date. Seollal and Chuseok move with the lunar
// calendar, and a generator that confidently announced the wrong day
// would be worse than one that never mentioned it — so the months say
// what is *around*, and the prompt tells the model not to state a date
// it has not been given.

const MONTHS = {
  1: ['the coldest weeks of the year, and how buildings are heated',
      'Seollal falls in late January or February — shops and transport change for it',
      'ski season', 'winter sales', 'the year-end tax settlement at work'],
  2: ['Seollal may fall this month', 'graduation season',
      'the spring semester starts soon — housing, registration, moving',
      'the cold starting to break'],
  3: ['the new school and university year begins',
      'fine dust and air quality', 'the first warm days', 'White Day on the 14th'],
  4: ['cherry blossoms, and the festivals around them',
      'yellow dust', 'hiking and picnics', 'mid-term exams on campus'],
  5: ['a month of holidays — Children’s Day, Parents’ Day, Teachers’ Day',
      'the best weather of the year', 'outdoor festivals', 'what to give, and to whom'],
  6: ['early summer', 'the rainy season starting', 'humidity and what to wear',
      'the semester ending'],
  7: ['jangma, the rainy season, in full', 'heat and humidity',
      'summer holidays', 'boknal and the food eaten on it', 'the Han river at night'],
  8: ['the hottest weeks', 'holiday season, and everywhere being full',
      'Liberation Day on the 15th', 'water parks, valleys and beaches'],
  9: ['Chuseok falls in September or October — travel and closures around it',
      'the heat breaking', 'the autumn semester', 'good weather returning'],
  10: ['autumn leaves', 'festival season', 'Hangul Day on the 9th',
       'the best month for walking a neighbourhood'],
  11: ['late autumn turning cold', 'kimjang, the winter kimchi-making',
       'the national university entrance exam, and how the country stops for it',
       'the first heating bills'],
  12: ['the year ending — hoesik, year-end gatherings',
       'Christmas as it is actually spent in Korea', 'snow and cold snaps',
       'winter markets and lights']
};

// What people actually ask, category by category. Seeds for thinking,
// not topics to copy: the prompt says to use them as evidence of what
// confuses people, and to write something neither too broad nor already
// on the site.
const QUESTIONS = {
  travel: [
    'which transport card to buy, and whether a tourist needs a different one',
    'how to pay when a card reader refuses a foreign card',
    'whether the subway app works in English and which one to install',
    'what to do at the airport at 2am when nothing runs',
    'how much to tip (and that you do not)',
    'how to get a taxi that will take a foreign passenger',
    'what happens if you tap out at the wrong station',
    'whether to buy a SIM, an eSIM or rent a pocket wifi'
  ],
  dining: [
    'how to order when the menu has no pictures and no English',
    'what the small dishes are, and whether they cost extra',
    'what to do when the restaurant expects you to cook the meat yourself',
    'how to eat somewhere alone without it being strange',
    'what is safe to eat with a nut, dairy or pork restriction',
    'how convenience store meals work, and what is worth buying',
    'whether you can ask for less spice',
    'how to pay — who pays, and when'
  ],
  style: [
    'what to actually buy in Olive Young, and what is a tourist trap',
    'how a Korean skincare routine differs from what you already do',
    'how to get the tax refund, and where the counter is',
    'what sizing means in Korean clothes shops',
    'whether a clinic will see a foreigner, and what it costs',
    'where to shop that is not Myeongdong',
    'how to read an ingredient list on a Korean product'
  ],
  explore: [
    'which neighbourhood suits what kind of day out',
    'how to find a filming location without a tour',
    'what a jjimjilbang is actually like, step by step',
    'where to go on a day trip without a car',
    'what a PC bang costs and how to use one',
    'what people really do at the Han river',
    'how to behave at a temple or palace'
  ],
  campus: [
    'what the alien registration card is for and how long it takes',
    'how to find a room without a Korean guarantor',
    'what jeonse and wolse mean and which one you want',
    'how to see a doctor, and what it costs without insurance',
    'how to open a bank account as a student',
    'what to do when a delivery needs a Korean phone number',
    'which government offices actually help foreigners',
    'how to set up utilities in a new flat'
  ],
  career: [
    'what visa lets a student work part time, and for how many hours',
    'what the minimum wage means in practice, after deductions',
    'how a Korean resume differs from the one you have',
    'what happens in a Korean interview',
    'how to find work that does not require fluent Korean',
    'what a labour contract should say',
    'what hoesik is, and whether you have to go'
  ],
  community: [
    'what jeong means and why people keep mentioning it',
    'how much to put in a wedding or funeral envelope',
    'what age has to do with how people speak to you',
    'why someone asked how old you are within a minute of meeting',
    'what changed this year for foreign residents',
    'how to apologise, and how to accept one',
    'what to bring when invited to someone’s home'
  ]
};

export function seasonFor(date) {
  const month = date.getMonth() + 1;
  return { month: month, notes: MONTHS[month] || [] };
}

export function questionsFor(category) {
  return QUESTIONS[category] || [];
}

// The day in Seoul, as YYYY-MM-DD, whatever the runner's clock is set
// to. Every date this generator writes is a Seoul date.
export function seoulToday(now) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now || new Date());
}

// …and the month, read the same way, so a run just after midnight in
// Seoul does not pick last month's calendar.
export function seoulDate(now) {
  const [y, m, d] = seoulToday(now).split('-').map(Number);
  return new Date(y, m - 1, d);
}
