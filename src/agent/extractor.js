/**
 * Entity & Intent Extractor
 * Extracts location, activity, target demographic, and timeframe from user queries.
 * Integrates conversational memory: preserves previous turn's location/activity
 * when follow-ups (e.g., "what about this evening?" or "in gorakhpur") omit them.
 */

// Common activity keywords and mappings
const ACTIVITY_KEYWORDS = [
  { match: ["cycl", "bike", "biking", "pedal", "peddle", "two wheel", "two-wheel", "two wheeler", "two-wheeler", "motorcycle", "scooter"], activity: "cycling" },
  { match: ["run", "jog", "jogging", "marathon", "sprint", "cardio"], activity: "running" },
  { match: ["picnic", "park", "garden", "lawn", "family outing"], activity: "picnic" },
  { match: ["drive", "driving", "road trip", "highway", "car travel", "travel", "commute", "cab"], activity: "travel" },
  { match: ["dog walk", "walk the dog", "pet", "pets", "canine"], activity: "pet_walk" },
  { match: ["morning walk", "evening walk", "walk outside", "stroll", "walking"], activity: "walking" },
  { match: ["outdoor gym", "workout", "cricket", "football", "tennis", "playground"], activity: "sports" },
];

const TARGET_GROUP_KEYWORDS = [
  { match: ["toddler", "toddlers", "infant", "infants", "baby", "babies", "kid", "kids", "child", "children"], group: "children" },
  { match: ["elderly", "senior", "seniors", "grandpa", "grandma", "grandfather", "grandmother", "aged", "old age"], group: "elderly" },
  { match: ["dog", "dogs", "puppy", "pet", "pets", "canine"], group: "pets" },
  { match: ["asthma", "respiratory", "breathing issue"], group: "sensitive" },
];

const TIMEFRAME_KEYWORDS = [
  { match: ["this evening", "evening", "tonight", "later tonight"], timeframe: "evening" },
  { match: ["this afternoon", "afternoon", "midday", "noon"], timeframe: "afternoon" },
  { match: ["this morning", "morning", "early morning", "dawn"], timeframe: "morning" },
  { match: ["tomorrow", "next day"], timeframe: "tomorrow" },
  { match: ["now", "right now", "currently", "today"], timeframe: "now" },
];

// Major Indian and global cities to extract reliably from free-form text
const KNOWN_CITIES = [
  "gorakhpur", "bhopal", "mumbai", "delhi", "new delhi", "bengaluru", "bangalore", "chennai", "kolkata",
  "hyderabad", "pune", "ahmedabad", "jaipur", "lucknow", "kanpur", "indore", "nagpur",
  "patna", "coimbatore", "kochi", "chandigarh", "surat", "varanasi", "visakhapatnam",
  "shimla", "dehradun", "srinagar", "goa", "agra", "prayagraj", "allahabad", "meerut",
  "bareilly", "aligarh", "ghaziabad", "noida", "gurugram", "gurgaon", "faridabad",
  "amritsar", "ludhiana", "jalandhar", "raipur", "ranchi", "jamshedpur", "bhubaneswar",
  "cuttack", "guwahati", "thiruvananthapuram", "mysuru", "mysore", "mangaluru", "mangalore",
  "gwalior", "jabalpur", "ujjain", "nashik", "aurangabad", "solapur", "kolhapur",
  "vadodara", "baroda", "rajkot", "udaipur", "jodhpur", "kota", "london", "berlin",
  "new york", "paris", "tokyo", "springfield", "singapore", "dubai"
];

/**
 * Extract intent and entities from current query and merge with session memory.
 * @param {string} query - Latest user message
 * @param {object} previousState - Existing state from conversation history
 * @returns {{activity: string|null, target_group: string, timeframe: string, location_name: string|null}}
 */
export function extractIntentAndEntities(query, previousState = {}) {
  const q = (query || "").toLowerCase();

  // 1. Extract Activity
  let detectedActivity = null;
  for (const item of ACTIVITY_KEYWORDS) {
    if (item.match.some(kw => q.includes(kw))) {
      detectedActivity = item.activity;
      break;
    }
  }

  // 2. Extract Target Group
  let detectedGroup = "all";
  for (const item of TARGET_GROUP_KEYWORDS) {
    if (item.match.some(kw => q.includes(kw))) {
      detectedGroup = item.group;
      break;
    }
  }

  // 3. Extract Timeframe
  let detectedTimeframe = "now";
  for (const item of TIMEFRAME_KEYWORDS) {
    if (item.match.some(kw => q.includes(kw))) {
      detectedTimeframe = item.timeframe;
      break;
    }
  }

  // 4. Extract Location
  let detectedLocation = null;

  // Step 4A: Check known cities dictionary first (word boundary match)
  for (const city of KNOWN_CITIES) {
    const regex = new RegExp(`\\b${city}\\b`, "i");
    if (regex.test(q)) {
      detectedLocation = city.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      break;
    }
  }

  // Step 4B: Robust Prepositional regex: "in Gorakhpur", "at Bhopal", "for Pune", "to Mumbai"
  if (!detectedLocation) {
    const prepRegex = /\b(?:in|at|around|near|for|to|of)\s+([a-zA-Z\s\-]+?)(?:\s+(?:today|now|tomorrow|tonight|this|this evening|this afternoon|this morning|safe|is|can|should|please)|[,\.\?!]|$)/i;
    const prepMatch = q.match(prepRegex);
    if (prepMatch && prepMatch[1]) {
      const candidate = prepMatch[1].trim();
      const skipWords = ["the", "my", "our", "this", "today", "a", "an", "good", "safe", "cycling", "running", "walking", "outdoor", "park", "picnic", "me", "it", "us", "there"];
      if (!skipWords.includes(candidate.toLowerCase()) && candidate.length >= 2) {
        detectedLocation = candidate.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      }
    }
  }

  // Step 4C: Direct Location Answer (e.g., when replying to clarification with just "Gorakhpur" or "in Gorakhpur")
  if (!detectedLocation) {
    const stripped = q.replace(/^(?:in|at|for|near|around)\s+/i, "").replace(/[,\.\?!]+$/, "").trim();
    const words = stripped.split(/\s+/);
    const nonLocationWords = ["can", "i", "is", "it", "safe", "should", "we", "what", "about", "today", "now", "tomorrow", "cycling", "running", "walking", "picnic", "hello", "hi", "hey"];
    const hasNonLocationWord = words.some(w => nonLocationWords.includes(w.toLowerCase()));
    if (words.length <= 3 && !hasNonLocationWord && stripped.length >= 2) {
      detectedLocation = stripped.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
    }
  }

  // 5. Contextual Memory Carrying (Multi-turn conversational continuity)
  // If user says "what about this evening?" or just specifies city "in Gorakhpur", carry forward context!
  const prevLocation = previousState.location?.name || null;
  const prevActivity = previousState.intent?.activity || null;
  const prevGroup = previousState.intent?.target_group || "all";

  const effectiveLocation = detectedLocation || prevLocation;
  const effectiveActivity = detectedActivity || prevActivity;
  const effectiveGroup = detectedGroup !== "all" ? detectedGroup : prevGroup;

  return {
    location_name: effectiveLocation,
    activity: effectiveActivity,
    target_group: effectiveGroup,
    timeframe: detectedTimeframe,
    isFollowUp: !detectedLocation && !detectedActivity && (!!prevLocation || !!prevActivity),
  };
}
