// Sample describe() models for the gallery and the layout tests
// (captured from a test run; the countdown is re-based to 'now' when loaded).
window.FC = window.FC || {};
FC.FIXTURES = [
 {
  "label": "Clock & weather",
  "plugin": "clock_weather",
  "model": {
   "ampm": "PM",
   "date": "Oct 31",
   "date_colors": [
    [
     255,
     255,
     255
    ],
    [
     143,
     37,
     170
    ]
   ],
   "daytime": false,
   "forecast": [
    {
     "code": 1001,
     "day": "Sat",
     "max": 60,
     "min": 52
    },
    {
     "code": 1001,
     "day": "Sun",
     "max": 59,
     "min": 52
    },
    {
     "code": 1001,
     "day": "Mon",
     "max": 63,
     "min": 56
    }
   ],
   "humidity": null,
   "moon_phase": 6,
   "temp": null,
   "time": "5:44",
   "view": "clock",
   "weekday": "Saturday"
  }
 },
 {
  "label": "Clock with an alert",
  "plugin": "clock_weather",
  "model": {
   "ampm": "PM",
   "date": "Oct 31",
   "date_colors": [
    [
     255,
     255,
     255
    ],
    [
     143,
     37,
     170
    ]
   ],
   "daytime": true,
   "forecast": [
    {
     "code": 1001,
     "day": "Sat",
     "max": 60,
     "min": 52
    },
    {
     "code": 1001,
     "day": "Sun",
     "max": 59,
     "min": 52
    },
    {
     "code": 1001,
     "day": "Mon",
     "max": 63,
     "min": 56
    }
   ],
   "humidity": null,
   "moon_phase": 6,
   "temp": null,
   "time": "5:44",
   "view": "clock",
   "weekday": "Saturday",
   "alerts": [
    {
     "text": "Wind Advisory until 9PM",
     "color": [
      255,
      160,
      0
     ]
    },
    {
     "text": "Sunset in 42m",
     "color": [
      255,
      120,
      60
     ]
    }
   ],
   "alert_index": 0
  }
 },
 {
  "label": "ISS overhead",
  "plugin": "clock_weather",
  "model": {
   "ampm": "PM",
   "date": "Oct 31",
   "date_colors": [
    [
     255,
     255,
     255
    ],
    [
     143,
     37,
     170
    ]
   ],
   "daytime": false,
   "forecast": [
    {
     "code": 1001,
     "day": "Sat",
     "max": 60,
     "min": 52
    },
    {
     "code": 1001,
     "day": "Sun",
     "max": 59,
     "min": 52
    },
    {
     "code": 1001,
     "day": "Mon",
     "max": 63,
     "min": 56
    }
   ],
   "humidity": null,
   "moon_phase": 6,
   "temp": null,
   "time": "5:44",
   "view": "iss",
   "weekday": "Saturday",
   "progress": 0.42,
   "remaining_sec": 187,
   "rise_azimuth": "SW",
   "set_azimuth": "NE",
   "max_elevation": 64
  }
 },
 {
  "label": "Flight overhead",
  "plugin": "flight_tracker",
  "model": {
   "airline": "United Airlines",
   "altitude": 12225,
   "callsign": "UAL1776",
   "count": 5,
   "destination": "PHL",
   "destination_color": [
    103,
    186,
    106
   ],
   "details": false,
   "direction": "N",
   "distance": 2.3261851806932397,
   "distance_destination": 661.4061546039579,
   "distance_origin": 15.069208938932306,
   "ground_speed": 309,
   "index": 0,
   "number": "1776",
   "origin": "ORD",
   "origin_color": [
    103,
    186,
    106
   ],
   "owner_icao": "UAL",
   "plane": "B737",
   "registration": "N16709",
   "units": "mi",
   "view": "flight"
  }
 },
 {
  "label": "Radar",
  "plugin": "flight_tracker",
  "model": {
   "view": "radar",
   "home": [
    41.88,
    -87.63
   ],
   "radius_nm": 30,
   "planes": [
    {
     "callsign": "UAL1776",
     "lat": 41.95,
     "lon": -87.7,
     "altitude": 12225
    },
    {
     "callsign": "AAL233",
     "lat": 41.7,
     "lon": -87.4,
     "altitude": 31000
    },
    {
     "callsign": "SWA88",
     "lat": 42.2,
     "lon": -88.0,
     "altitude": 6000
    },
    {
     "callsign": "DAL412",
     "lat": 41.6,
     "lon": -88.1,
     "altitude": 22000
    }
   ]
  }
 },
 {
  "label": "Tracked flight",
  "plugin": "specific_flight_tracker",
  "model": {
   "index": 0,
   "count": 2,
   "units": "mi",
   "details": true,
   "city": "Des Moines",
   "poi": null,
   "flight": {
    "callsign": "UAL1234",
    "origin": "SFO",
    "destination": "ORD",
    "origin_color": [
     103,
     186,
     106
    ],
    "destination_color": [
     255,
     210,
     80
    ],
    "plane_type": "B39M",
    "registration": "N37522",
    "progress": 0.68,
    "dist_remaining": 612,
    "time_remaining": "1:12",
    "altitude": 37000,
    "ground_speed": 468
   }
  }
 },
 {
  "label": "Stocks",
  "plugin": "stock_ticker",
  "model": {
   "etfs": [
    {
     "day_change_pct": -1.7729021524383886,
     "price": 755.72,
     "symbol": "SPY"
    },
    {
     "day_change_pct": -3.473872564095398,
     "price": 690.49,
     "symbol": "QQQ"
    }
   ],
   "stocks": [
    {
     "day_change_pct": -1.2266773666561661,
     "price": 344.63,
     "symbol": "AAPL"
    },
    {
     "day_change_pct": -1.5524201154412076,
     "price": 521.91,
     "symbol": "MSFT"
    },
    {
     "day_change_pct": -4.22166058223346,
     "price": 204.64,
     "symbol": "NVDA"
    }
   ]
  }
 },
 {
  "label": "Sports",
  "plugin": "sports",
  "model": {
   "count": 80,
   "game": {
    "away": {
     "color": [
      29,
      66,
      138
     ],
     "home_away": "away",
     "logo_url": "https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/phi.png",
     "name": "PHI",
     "score": "69",
     "team_id": "20"
    },
    "clock": "3:58",
    "game_date": "2026-10-31",
    "game_id": "401909897",
    "home": {
     "color": [
      0,
      140,
      168
     ],
     "home_away": "home",
     "logo_url": "https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/cha.png",
     "name": "CHA",
     "score": "75",
     "team_id": "30"
    },
    "league": "NBA",
    "league_id": "nba",
    "period": 3,
    "situation": {
     "balls": 0,
     "distance": 0,
     "down": 0,
     "outs": 0,
     "possession": "",
     "strikes": 0
    },
    "state": "in",
    "status_detail": "3:58 - 3rd"
   },
   "index": 0
  }
 },
 {
  "label": "World daylight",
  "plugin": "world_daylight",
  "model": {
   "date": "Oct 31",
   "moon": [
    23.77202442959538,
    81.42915651880776
   ],
   "moon_phase": 6,
   "night": false,
   "sun": [
    -14.354583027858059,
    179.67616146810118
   ],
   "time": "5:44 PM"
  }
 },
 {
  "label": "Breaking news",
  "plugin": "ap_news",
  "model": {
   "banner": "BREAKING NEWS",
   "headlines": [
    "2026 Elections Live Updates: Candidates Campaign in Battleground States on Final Weekend",
    "Judge dismisses Trump lawsuit against Wall Street Journal over Epstein birthday letter",
    "Ukrainian evacuees reunite with family after years trapped in Russia-occupied city",
    "Iran's leader says response to attack would have no 'geographic limits,' and other Mideast news",
    "Judge orders Trump officials not to threaten or intimidate election workers",
    "Mamdani says Trump will 'immediately' grant visa to Ghanaian mom of slain Bronx teen",
    "31-year-old pregnant woman identified as killed in Fairfield shooting at Spirit Halloween",
    "D.C. and Virginia sue to block Trump\u2019s proposed triumphal arch",
    "More than 50m Americans cast ballots in early voting with three days to go before midterms",
    "ICE agent charged with assault for hitting a fleeing man with his car will turn himself in on Monday",
    "A third weekend of protests in France as youth-led rallies sweep Europe",
    "Polish president in physical confrontation with judges amid power struggle at constitutional court",
    "London police arrest 139 as hundreds protest Palestine Action ban",
    "Thousands return to Lisbon square, press government to scrap rental bill",
    "Binance CEO says 90 percent of stolen assets have been \u2018replenished\u2019",
    "Investors trim growth bets over fears of US economy\u2019s AI exposure",
    "Oil company earnings skyrocket \u2014 again",
    "Tech stock meltdown could get a lot of worse if history is any guide",
    "I took two iPhones on vacation. The Duo won me over.",
    "Motorola Signature 27 specs detailed in new video, including Tandem OLED display",
    "My Favorite Smartwatch Has Stayed on My Wrist for Years \u2014 No, It\u2019s Not an Apple Watch",
    "A Supply Chain Attack Put Malicious Anthropic Claude Extensions on Thousands of Devices",
    "Best Celebrity Halloween Costumes 2026: Paris Hilton as Britney Spears, Lisa Rinna as Kylie Jenner and More",
    "Box Office: \u2018You Can See Everything\u2019 Fends Off \u2018Clayface\u2019 for Top Spot on Friday With $3.56 Million",
    "Margaret Qualley and Jack Antonoff File for Divorce, Following Months of Speculation",
    "'Green Room' Writer/Director Says Patrick Stewart \"Saved The Day\"",
    "Canelo Alvarez turns back the clock, schools Christian Mbilli to reclaim WBC world title",
    "College football live updates, scores: Week 9 schedule features BYU vs. Arizona State, Utah in action",
    "UFC Fight Night 292 live updates: Renato Moicano vs. Tom Nolan results",
    "Man United implode at Chelsea; they are now in Premier League relegation battle",
    "NASA telescope is on the verge of plunging back to Earth after failed rescue mission - ABC News",
    "Strange beaked 'hell chicken' is the first fruit-eating dinosaur",
    "November\u2019s Night Sky Brings A Supermoon And A Rare Mars-Jupiter Meetup",
    "Meteorite Found in Sahara is Piece of Mars at Least 4.1 Billion Years Old",
    "More than 5,000 die from Ebola in DR Congo's deadliest outbreak",
    "As a historic measles outbreak hits Pennsylvania Amish country, more show openness to vaccines",
    "Weekly US Influenza Surveillance Report: Key Updates for Week 42, ending October 24, 2026 | FluView",
    "Have we been thinking about women\u2019s heart health all wrong? Leading medical societies think so."
   ]
  }
 },
 {
  "label": "Countdown",
  "plugin": "event_countdown",
  "model": {
   "event_ts": 1795716000.0,
   "line1": "26 DAYS",
   "line2": "18:15:03",
   "now": false,
   "title": "Thanksgiving",
   "event_ts_offset": 2225441.3456709385
  }
 },
 {
  "label": "World clock",
  "plugin": "world_clock",
  "model": {
   "rows": [
    {
     "day": true,
     "marker": "",
     "name": "Seattle",
     "time": "4:44P"
    },
    {
     "day": true,
     "marker": "",
     "name": "Denver",
     "time": "5:44P"
    },
    {
     "day": true,
     "marker": "",
     "name": "Honolulu",
     "time": "1:44P"
    },
    {
     "day": true,
     "marker": "",
     "name": "Anchorage",
     "time": "3:44P"
    },
    {
     "day": true,
     "marker": "",
     "name": "San Fran",
     "time": "4:44P"
    }
   ]
  }
 },
 {
  "label": "System stats",
  "plugin": "system_stats",
  "model": {
   "hosts": [
    {
     "name": "My Mac",
     "offline": false,
     "stats": [
      {
       "color": [
        80,
        220,
        220
       ],
       "frac": 0.27099999999999996,
       "key": "cpu",
       "label": "CPU",
       "value": "27%"
      },
      {
       "color": [
        160,
        160,
        255
       ],
       "frac": 0.0,
       "key": "gpu",
       "label": "GPU",
       "value": "0%"
      },
      {
       "color": [
        250,
        210,
        120
       ],
       "frac": 0.55,
       "key": "mem",
       "label": "MEM",
       "value": "55%"
      }
     ],
     "uptime": ""
    }
   ]
  }
 },
 {
  "label": "Calendar",
  "plugin": "calendar",
  "model": {
   "events": [
    {
     "all_day": true,
     "color": [
      59,
      130,
      246
     ],
     "day": "TODAY",
     "location": "",
     "now": false,
     "source": "Holidays",
     "sub": "DAY",
     "time": "ALL",
     "time_color": [
      235,
      235,
      235
     ],
     "title": "Halloween"
    },
    {
     "all_day": true,
     "color": [
      59,
      130,
      246
     ],
     "day": "TOMORROW",
     "location": "",
     "now": false,
     "source": "Holidays",
     "sub": "DAY",
     "time": "ALL",
     "time_color": [
      235,
      235,
      235
     ],
     "title": "Daylight Saving Time ends"
    },
    {
     "all_day": true,
     "color": [
      59,
      130,
      246
     ],
     "day": "TUE 11/3",
     "location": "",
     "now": false,
     "source": "Holidays",
     "sub": "DAY",
     "time": "ALL",
     "time_color": [
      235,
      235,
      235
     ],
     "title": "Election Day"
    },
    {
     "all_day": true,
     "color": [
      59,
      130,
      246
     ],
     "day": "WED 11/11",
     "location": "",
     "now": false,
     "source": "Holidays",
     "sub": "DAY",
     "time": "ALL",
     "time_color": [
      235,
      235,
      235
     ],
     "title": "Veterans Day"
    },
    {
     "all_day": true,
     "color": [
      59,
      130,
      246
     ],
     "day": "THU 11/26",
     "location": "",
     "now": false,
     "source": "Holidays",
     "sub": "DAY",
     "time": "ALL",
     "time_color": [
      235,
      235,
      235
     ],
     "title": "Thanksgiving Day"
    }
   ],
   "index": 0,
   "view": "detailed"
  }
 },
 {
  "label": "Calendar reminder",
  "plugin": "calendar",
  "model": {
   "view": "reminder",
   "title": "IN 10 MIN",
   "index": 0,
   "events": [
    {
     "title": "Dentist appointment",
     "location": "123 Main St",
     "source": "Family",
     "color": [
      230,
      90,
      120
     ],
     "time": "3:00P",
     "time_color": [
      235,
      235,
      235
     ],
     "sub": "-3:30P",
     "day": "TODAY",
     "now": false,
     "all_day": false
    }
   ]
  }
 },
 {
  "label": "Calendar (compact)",
  "plugin": "calendar",
  "model": {
   "view": "compact",
   "rows": [
    {
     "event": {
      "title": "Dentist appointment",
      "location": "123 Main St",
      "source": "Family",
      "color": [
       230,
       90,
       120
      ],
      "time": "3:00P",
      "time_color": [
       235,
       235,
       235
      ],
      "sub": "-3:30P",
      "day": "TODAY",
      "now": false,
      "all_day": false
     }
    },
    {
     "event": {
      "title": "Soccer practice",
      "location": "123 Main St",
      "source": "Family",
      "color": [
       80,
       180,
       90
      ],
      "time": "5:30P",
      "time_color": [
       235,
       235,
       235
      ],
      "sub": "-3:30P",
      "day": "TODAY",
      "now": false,
      "all_day": false
     }
    },
    {
     "day": "TOMORROW"
    },
    {
     "event": {
      "title": "Team standup",
      "location": "123 Main St",
      "source": "Family",
      "color": [
       90,
       140,
       240
      ],
      "time": "9:00A",
      "time_color": [
       235,
       235,
       235
      ],
      "sub": "-3:30P",
      "day": "TODAY",
      "now": false,
      "all_day": false
     }
    },
    {
     "event": {
      "title": "Lunch with Sam",
      "location": "123 Main St",
      "source": "Family",
      "color": [
       90,
       140,
       240
      ],
      "time": "12:00P",
      "time_color": [
       235,
       235,
       235
      ],
      "sub": "-3:30P",
      "day": "TODAY",
      "now": false,
      "all_day": false
     }
    }
   ]
  }
 },
 {
  "label": "Maze",
  "plugin": "maze",
  "model": {
   "pixels": true,
   "phase": "solving"
  }
 },
 {
  "label": "Maze solved",
  "plugin": "maze",
  "model": {
   "pixels": true,
   "phase": "stats",
   "lines": [
    "SOLVED",
    "14 DEAD ENDS",
    "212 STEPS"
   ],
   "accent": [
    255,
    210,
    0
   ]
  }
 },
 {
  "label": "Now playing",
  "plugin": "now_playing",
  "model": {
   "title": "Here Comes the Sun",
   "artist": "The Beatles",
   "album": "Abbey Road",
   "source": "mac",
   "art_url": null,
   "art_key": "",
   "has_art": false,
   "progress": 0.37,
   "can_skip": true
  }
 },
 {
  "label": "Now playing (paused)",
  "plugin": "now_playing",
  "model": {
   "title": "Clair de Lune",
   "artist": "Claude Debussy",
   "album": "Suite bergamasque",
   "source": "spotify",
   "art_url": null,
   "art_key": "",
   "has_art": false,
   "progress": 0.62,
   "can_skip": true,
   "paused": true
  }
 },
 {
  "label": "Transit",
  "plugin": "transit",
  "model": {
   "view": "board",
   "time_label": "Min",
   "pages": [
    {
     "title": null,
     "rows": [
      {
       "label": "Red",
       "color": [
        198,
        12,
        48
       ],
       "dest": "Howard",
       "short": "Howard",
       "min": "Due",
       "realtime": true,
       "missable": true
      },
      {
       "label": "Red",
       "color": [
        198,
        12,
        48
       ],
       "dest": "95th/Dan Ryan",
       "short": "95th",
       "min": "4",
       "realtime": true,
       "missable": false
      },
      {
       "label": "Brn",
       "color": [
        98,
        54,
        27
       ],
       "dest": "Kimball",
       "short": "Kimball",
       "min": "7",
       "realtime": true,
       "missable": false
      },
      {
       "label": "22",
       "color": [
        80,
        80,
        200
       ],
       "dest": "Harrison",
       "short": "Harrison",
       "min": "12",
       "realtime": false,
       "missable": false
      }
     ]
    }
   ]
  }
 },
 {
  "label": "Snow report",
  "plugin": "snow_report",
  "model": {
   "index": 0,
   "count": 2,
   "report": {
    "name": "Vail",
    "base_depth": 38,
    "new_snow_24h": 6,
    "snow_unit": "\"",
    "conditions": "Powder",
    "open_trails": 142,
    "total_trails": 195,
    "error": null
   }
  }
 },
 {
  "label": "AI usage",
  "plugin": "ai_usage",
  "model": {
   "index": 0,
   "count": 2,
   "provider": "claude",
   "title": "CLAUDE USAGE",
   "color": [
    217,
    119,
    87
   ],
   "reset_format": "times",
   "current_pct": 42,
   "weekly_pct": 71,
   "current_reset": "4:00P",
   "weekly_reset": "Thu 9A",
   "current_countdown": "1h 12m",
   "weekly_countdown": "4d 3h"
  }
 },
 {
  "label": "Unknown module (pixels)",
  "plugin": "some_new_plugin",
  "model": null
 }
];
for (const f of FC.FIXTURES) if (f.model && f.model.event_ts_offset != null) f.model.event_ts = Date.now() / 1000 + f.model.event_ts_offset;
