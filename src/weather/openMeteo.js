import axios from "axios";

/**
 * Open-Meteo Weather Client
 * Interacts with Open-Meteo's free Geocoding and Forecast endpoints.
 * Handles current and hourly prospective time-of-day windows.
 */

const GEOCODING_BASE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_BASE_URL = "https://api.open-meteo.com/v1/forecast";

/**
 * Geocode a city name to latitude and longitude coordinates.
 * @param {string} cityName 
 * @returns {Promise<{success: boolean, location?: {name: string, latitude: number, longitude: number, country: string, admin1?: string}, error?: string}>}
 */
export async function geocodeCity(cityName) {
  if (!cityName || typeof cityName !== "string" || cityName.trim().length === 0) {
    return { success: false, error: "LOCATION_NAME_REQUIRED" };
  }

  const cleanName = cityName.trim();

  try {
    const response = await axios.get(GEOCODING_BASE_URL, {
      params: {
        name: cleanName,
        count: 5,
        language: "en",
        format: "json",
      },
      timeout: 6000,
    });

    const results = response.data?.results;
    if (!results || !Array.isArray(results) || results.length === 0) {
      return {
        success: false,
        error: "LOCATION_NOT_FOUND",
        message: `Could not resolve coordinates for location "${cleanName}".`
      };
    }

    // Sort candidates by population descending so major cities take precedence
    results.sort((a, b) => (b.population || 0) - (a.population || 0));

    // Pick top candidate as primary location
    const topResult = results[0];
    return {
      success: true,
      location: {
        name: topResult.name,
        latitude: topResult.latitude,
        longitude: topResult.longitude,
        country: topResult.country || "",
        admin1: topResult.admin1 || "",
        timezone: topResult.timezone || "auto",
      }
    };
  } catch (err) {
    return {
      success: false,
      error: "GEOCODING_SERVICE_UNAVAILABLE",
      message: `Geocoding service failed or timed out: ${err.message}`
    };
  }
}

/**
 * Fetch live and hourly weather data for given coordinates.
 * @param {number} latitude 
 * @param {number} longitude 
 * @param {string} [timeframe="now"] - e.g. "now", "evening", "afternoon", "morning"
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export async function fetchWeatherData(latitude, longitude, timeframe = "now") {
  if (latitude === undefined || longitude === undefined) {
    return { success: false, error: "COORDINATES_MISSING" };
  }

  try {
    const response = await axios.get(FORECAST_BASE_URL, {
      params: {
        latitude,
        longitude,
        current: [
          "temperature_2m",
          "relative_humidity_2m",
          "precipitation",
          "precipitation_probability",
          "weather_code",
          "wind_speed_10m",
          "wind_gusts_10m",
          "uv_index"
        ].join(","),
        hourly: [
          "temperature_2m",
          "relative_humidity_2m",
          "precipitation",
          "precipitation_probability",
          "weather_code",
          "wind_speed_10m",
          "wind_gusts_10m",
          "uv_index"
        ].join(","),
        timezone: "auto",
      },
      timeout: 7000,
    });

    const raw = response.data;
    if (!raw || !raw.current) {
      return {
        success: false,
        error: "INVALID_WEATHER_PAYLOAD",
        message: "Weather API responded without current metrics."
      };
    }

    const currentMetrics = {
      temperature_2m: Number(raw.current.temperature_2m ?? 0),
      relative_humidity_2m: Number(raw.current.relative_humidity_2m ?? 0),
      precipitation: Number(raw.current.precipitation ?? 0),
      precipitation_probability: Number(raw.current.precipitation_probability ?? 0),
      weather_code: Number(raw.current.weather_code ?? 0),
      wind_speed_10m: Number(raw.current.wind_speed_10m ?? 0),
      wind_gusts_10m: Number(raw.current.wind_gusts_10m ?? raw.current.wind_speed_10m ?? 0),
      uv_index: Number(raw.current.uv_index ?? 0),
      time: raw.current.time,
    };

    // If specific timeframe requested (e.g. "evening"), extract representative slot from hourly data
    let effectiveMetrics = { ...currentMetrics };
    let windowLabel = "Current Conditions";

    if (raw.hourly && raw.hourly.time && timeframe && timeframe !== "now") {
      const hourlySlot = extractHourlyWindow(raw.hourly, timeframe);
      if (hourlySlot) {
        effectiveMetrics = {
          ...currentMetrics,
          ...hourlySlot.metrics,
        };
        windowLabel = hourlySlot.label;
      }
    }

    return {
      success: true,
      data: {
        effectiveMetrics,
        currentMetrics,
        units: raw.current_units || {
          temperature_2m: "°C",
          wind_speed_10m: "km/h",
          precipitation: "mm",
          precipitation_probability: "%",
          uv_index: "index",
        },
        windowLabel,
        rawTime: raw.current.time,
        elevation: raw.elevation,
      }
    };
  } catch (err) {
    return {
      success: false,
      error: "WEATHER_API_UNREACHABLE",
      message: `Open-Meteo forecast API unreachable: ${err.message}`
    };
  }
}

/**
 * Helper to pick representative hourly metrics for a timeframe.
 */
function extractHourlyWindow(hourly, timeframe) {
  const times = hourly.time || [];
  if (times.length === 0) return null;

  const now = new Date();
  const currentHour = now.getHours();

  // Target hour mapping for Indian local/standard query timeframes
  let targetHour = currentHour;
  let label = "Current";

  const tf = timeframe.toLowerCase();
  if (tf.includes("evening")) {
    targetHour = 19; // 7 PM
    label = "Evening Forecast (18:00 - 21:00)";
  } else if (tf.includes("afternoon")) {
    targetHour = 14; // 2 PM
    label = "Afternoon Forecast (13:00 - 16:00)";
  } else if (tf.includes("morning")) {
    targetHour = 8; // 8 AM
    label = "Morning Forecast (07:00 - 10:00)";
  } else if (tf.includes("night")) {
    targetHour = 22; // 10 PM
    label = "Night Forecast (21:00 - 00:00)";
  }

  // Find index in hourly.time matching today at targetHour
  let matchedIndex = 0;
  for (let i = 0; i < times.length; i++) {
    const d = new Date(times[i]);
    if (d.getHours() === targetHour) {
      matchedIndex = i;
      break;
    }
  }

  return {
    label,
    metrics: {
      temperature_2m: Number(hourly.temperature_2m?.[matchedIndex] ?? hourly.temperature_2m?.[0] ?? 0),
      relative_humidity_2m: Number(hourly.relative_humidity_2m?.[matchedIndex] ?? 0),
      precipitation: Number(hourly.precipitation?.[matchedIndex] ?? 0),
      precipitation_probability: Number(hourly.precipitation_probability?.[matchedIndex] ?? 0),
      weather_code: Number(hourly.weather_code?.[matchedIndex] ?? 0),
      wind_speed_10m: Number(hourly.wind_speed_10m?.[matchedIndex] ?? 0),
      wind_gusts_10m: Number(hourly.wind_gusts_10m?.[matchedIndex] ?? 0),
      uv_index: Number(hourly.uv_index?.[matchedIndex] ?? 0),
      time: times[matchedIndex],
    }
  };
}
