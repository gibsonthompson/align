// Words that point a calendar block at one area of Gibson's life. Matching is on
// whole words (a trailing * matches any ending: "meditat*" matches meditate and
// meditation). Phrases match as written. Area slugs must exist in align_sectors.

export const AREA_RULES: Record<string, string[]> = {
  // Business & Career
  'business-entrepreneurship': [
    'voiceai', 'voice ai', 'voiceai connect', 'scopebook', 'gtc', 'gtc group', 'logistics', 'restomate', 'documate', 'haul it all', 'rocket solutions', 'rocket reels',
    'bookd', 'frontdesk flex', 'content farm', 'blog farm', 'forward fitness', 'align app', 'sesh', 'hq app', 'clyde', 'saas', 'startup',
    'build', 'ship', 'deploy', 'code', 'coding', 'bug', 'feature', 'launch', 'product', 'app', 'website', 'landing page', 'repo', 'supabase', 'vercel',
  ],
  'business-growth': [
    'client', 'clients', 'customer', 'customers', 'sales', 'sell', 'prospect*', 'outreach', 'cold email*', 'lead', 'leads', 'demo', 'demos', 'pitch',
    'onboard*', 'marketing', 'ads', 'seo', 'campaign', 'partnership', 'partner', 'agency', 'agencies', 'support ticket*', 'follow up', 'follow-up',
    'proposal', 'quote', 'callbird', 'law firm*', 'med spa*', 'homeworth', 'toro', 'jb lawn', 'southern peach', 'splash restoration', 'fir and forge', 'fir & forge',
  ],
  'business-career': ['rsa', 'reliable solutions', 'waterhelpme', 'work shift', 'shift', 'job', 'boss', 'manager', 'performance review', 'promotion', 'resume', 'interview'],
  'business-professional-development': ['conference', 'webinar', 'certification', 'mentor', 'mentorship', 'masterclass'],
  'business-skills': ['consulting', 'freight', 'opportunity', 'opportunities'],
  business: ['meeting', 'meetings', 'call with', 'sync', 'standup', 'stand-up', 'check-in call', 'admin', 'email inbox', 'inbox zero', 'work', 'deep work', 'office'],

  // Financial Health & Wealth
  'finance-income': ['invoice', 'invoices', 'payroll', 'payout', 'stripe payout', 'raise rates', 'pricing', 'revenue'],
  'finance-budgeting': ['budget', 'budgeting', 'bills', 'pay bills', 'rent', 'mortgage', 'subscriptions', 'expenses', 'receipts', 'money app'],
  'finance-savings': ['savings', 'save money', 'emergency fund'],
  'finance-debt': ['debt', 'loan', 'credit card', 'payoff', 'pay off'],
  'finance-investments': ['invest', 'investing', 'investment*', 'stocks', 'brokerage', 'portfolio', 'crypto', 'index fund*', 'roth', 'ira', '401k'],
  'finance-independence': ['net worth', 'retirement', 'financial plan*', 'taxes', 'tax', 'cpa', 'accountant'],
  finance: ['bank', 'finances', 'financial'],

  // Physical Health & Fitness
  'health-strength': ['gym', 'lift', 'lifting', 'weights', 'workout', 'work out', 'bench', 'squat*', 'deadlift*', 'push day', 'pull day', 'leg day', 'upper body', 'lower body', 'strength', 'pushups', 'pull-ups', 'pullups'],
  'health-cardio': ['run', 'runs', 'running', 'jog', 'jogging', 'long run', 'easy run', 'tempo run', 'intervals', 'strides', 'cardio', 'bike', 'cycling', 'swim', 'swimming', 'row', 'rowing', 'half marathon', 'marathon', '5k', '10k', 'treadmill', 'zone 2'],
  'health-sports-performance': ['training', 'mobility', 'agility', 'speed work', 'sport training'],
  'health-nutrition': ['meal prep', 'meal', 'meals', 'cook', 'cooking', 'protein', 'nutrition', 'diet', 'macros', 'calories', 'dinner prep', 'grocery', 'groceries', 'smoothie', 'supplements'],
  'health-sleep': ['sleep', 'nap', 'bedtime', 'wind down', 'recovery', 'rest day', 'stretch', 'stretching', 'foam roll*', 'sauna', 'cold plunge', 'massage', 'yoga'],
  'health-general': ['doctor', 'dentist', 'physical', 'checkup', 'check-up', 'appointment', 'pharmacy', 'eye exam', 'blood work', 'bloodwork', 'dermatologist', 'teeth'],
  health: ['health', 'fitness', 'walk', 'walking', 'steps'],

  // Sports, Hobbies & Recreation
  'recreation-music': ['guitar', 'piano', 'music', 'song', 'songs', 'chords', 'practice guitar', 'metronome', 'wonderwall', 'sing', 'singing', 'band', 'record', 'recording', 'ukulele', 'drums'],
  'recreation-sports': ['golf', 'basketball', 'pickleball', 'tennis', 'soccer', 'football', 'baseball', 'softball', 'volleyball', 'league', 'pickup game'],
  'recreation-skills': ['drawing', 'painting', 'photography', 'woodworking', 'chess', 'hobby'],
  'recreation-entertainment': ['movie', 'movies', 'tv', 'show', 'netflix', 'gaming', 'video game*', 'game night', 'youtube', 'podcast'],
  'recreation-activities': ['fishing', 'hunting', 'camping', 'hike', 'hiking', 'kayak*', 'boating', 'lake', 'trail'],

  // Relationships & Social Life
  'relationships-family': ['family', 'mom', 'dad', 'mother', 'father', 'parents', 'brother', 'sister', 'grandma', 'grandpa', 'grandparents', 'kids', 'son', 'daughter', 'cousin', 'aunt', 'uncle', 'family dinner'],
  'relationships-friendships': ['friend', 'friends', 'hang out', 'hangout', 'catch up', 'birthday', 'party', 'boys night', 'girls night', 'drinks with'],
  'relationships-romantic': ['date night', 'girlfriend', 'boyfriend', 'wife', 'husband', 'partner time', 'anniversary', 'valentine*'],
  'relationships-dating': ['date', 'first date', 'dating', 'hinge', 'bumble'],
  'relationships-community': ['church', 'volunteer*', 'community', 'service', 'small group', 'neighbors'],
  'relationships-social': ['networking', 'meetup', 'mixer', 'social'],

  // Personal Development & Education
  'growth-reading': ['read', 'reading', 'book', 'books', 'audiobook', 'kindle', 'chapter'],
  'growth-learning': ['course', 'class', 'classes', 'study', 'studying', 'learn', 'learning', 'lesson', 'tutorial', 'homework', 'lecture', 'spanish', 'language'],
  'growth-communication': ['public speaking', 'speech', 'presentation', 'writing', 'write', 'blog post', 'newsletter'],
  'growth-intellectual': ['research', 'documentary', 'philosophy', 'history', 'think'],
  'growth-skills': ['practice skill', 'skill', 'skills', 'typing', 'excel', 'productivity'],

  // Mental Wellbeing & Inner Life
  'mind-mindfulness': ['meditat*', 'mindful*', 'breathwork', 'breathing', 'prayer', 'pray', 'quiet time', 'devotional', 'bible'],
  'mind-self-awareness': ['journal', 'journaling', 'reflect*', 'review my week', 'weekly review', 'therapy', 'therapist', 'counseling'],
  'mind-stress': ['decompress', 'unwind', 'relax', 'stress', 'break', 'downtime'],
  'mind-confidence': ['affirmations', 'confidence', 'self talk'],
  'mind-resilience': ['gratitude', 'grateful'],
  'mind-fulfillment': ['purpose', 'vision board', 'goals review', 'plan my life', 'life plan*'],

  // Environment & Lifestyle
  'environment-organization': ['clean', 'cleaning', 'laundry', 'organize', 'organizing', 'declutter', 'tidy', 'dishes', 'vacuum', 'closet', 'garage'],
  'environment-home': ['home repair', 'fix', 'repair', 'yard', 'mow', 'lawn', 'landscaping', 'plumber', 'electrician', 'furniture', 'decorate'],
  'environment-living': ['move', 'moving', 'apartment', 'lease', 'house hunt*', 'realtor', 'new place'],
  'environment-routines': ['morning routine', 'evening routine', 'routine', 'errand', 'errands', 'car wash', 'oil change', 'haircut', 'barber', 'shopping'],
  'environment-lifestyle': ['plan the week', 'weekly planning', 'plan tomorrow', 'calendar planning'],

  // Experiences & Adventure
  'experiences-travel': ['trip', 'travel', 'flight', 'fly to', 'airport', 'vacation', 'hotel', 'airbnb', 'road trip', 'beach'],
  'experiences-events': ['concert', 'festival', 'game day', 'race day', 'show tickets', 'event', 'wedding', 'graduation'],
  'experiences-exploring': ['explore', 'exploring', 'new restaurant', 'day trip', 'museum'],
  'experiences-challenges': ['challenge', 'race', 'compete', 'competition', 'ironman', 'tough mudder'],
  'experiences-bucket-list': ['bucket list', 'skydiv*', 'scuba', 'once in a lifetime'],
};

export function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9&'\- ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

// Scores every area for a title and its notes. Title words count double.
export function scoreAreas(title: string, notes: string): { slug: string; score: number; hits: string[] }[] {
  const t = normalise(title);
  const n = normalise(notes);
  const out: { slug: string; score: number; hits: string[] }[] = [];
  for (const [slug, words] of Object.entries(AREA_RULES)) {
    let score = 0;
    const hits: string[] = [];
    for (const w of words) {
      const stem = w.endsWith('*');
      const word = stem ? w.slice(0, -1) : w;
      const re = new RegExp(`[ \\-]${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${stem ? '[a-z]*' : ''}(?=[ \\-'])`);
      const phrase = word.includes(' ') ? 1.5 : 1;
      if (re.test(t)) {
        score += 3 * phrase;
        hits.push(word);
      } else if (re.test(n)) {
        score += 1.5 * phrase;
        hits.push(word);
      }
    }
    // Sector-wide words ("meeting", "work") count less than a specific area's words.
    if (!slug.includes('-')) score *= 0.6;
    if (score > 0) out.push({ slug, score, hits });
  }
  return out.sort((a, b) => b.score - a.score);
}
