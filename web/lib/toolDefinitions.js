export const TOOLS = [

  {
    type: "function",
    function: {

      name: "create_event",
      description: "Create a calendar event at a specific date and time. Can repeat — use this for anything recurring that occupies real time: classes, gym sessions, club meetings, shifts, standing calls. For the FIRST occurrence, give the date of the first one.",

      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          year: { type: "integer" },
          month: { type: "integer", description: "1-12" },
          day: { type: "integer" },
          hour: { type: "integer", description: "24-hour format, 0-23" },
          minute: { type: "integer" },
          durationMinutes: {
            type: "integer",
            description: "Length of the event in minutes. Defaults to 60 if not mentioned."
          },
          recurrence: {
            type: "string",
            enum: ["daily", "weekdays", "weekly", "biweekly", "monthly", "yearly"],
            description: "Only when the user said it repeats. 'every Tuesday' is weekly, 'every other week' is biweekly, 'every weekday' or 'Monday to Friday' is weekdays. Omit for a one-off."
          },
          recurrenceCount: {
            type: "integer",
            description: "Only if the user said how many times ('for the next 8 weeks'). Omit for an open-ended repeat."
          },
          color: {
            type: "string",
            enum: ["red", "tomato", "tangerine", "banana", "basil", "sage", "peacock", "blueberry", "lavender", "grape", "flamingo", "graphite"],
            description: "Only if the user asked for a specific colour. Omit otherwise — events are coloured automatically by what kind of thing they are."
          }
        },
        required: ["title", "year", "month", "day", "hour", "minute"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "create_task",
      description: "Create a single to-do task, optionally with a due date. For anything that REPEATS (every day, every Tuesday, weekly), prefer create_event — a Google to-do cannot recur. If you do set a recurrence here it will be created as a recurring calendar reminder instead.",

      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          year: { type: "integer" },
          month: { type: "integer" },
          day: { type: "integer" },
          hour: { type: "integer" },
          minute: { type: "integer" },
          recurrence: {
            type: "string",
            enum: ["daily", "weekdays", "weekly", "biweekly", "monthly", "yearly"],
            description: "Only when the user said it repeats ('every morning', 'every Tuesday'). Omit for a one-off task."
          },
          recurrenceCount: {
            type: "integer",
            description: "Only if the user said how many times ('for the next 4 weeks'). Omit for an open-ended repeat."
          }
        },
        required: ["title"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "save_memory",
      description: "Save something about WHO THE USER IS — a preference, habit, trait, relationship, or personal circumstance — that should shape how you talk to them in future. The subject of the sentence is the user themselves ('I prefer...', 'I hate...', 'I have...'). If the subject is something external — a place's hours, someone else's phone number, a fact that doesn't describe the user — that is save_note, not this, even if the phrase starts with 'remember' or 'note that'. Test: does this change how you'd talk to the user, or is it just a fact they'd look up later? The second one is save_note.",

      parameters: {
        type: "object",
        properties: {
          type: { type: "string", description: "Category, e.g. 'preference' or 'fact'." },
          content: { type: "string" },
          importance: { type: "integer", description: "0-10" }
        },
        required: ["type", "content", "importance"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "query_schedule",
      description: "Answer a question ABOUT the user's calendar, schedule, events, or availability. Read-only — it only reports what is already there. Never use it to create, move, reschedule, or cancel anything; a request to change an existing event is modify_event, even when it names a day.",

      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "YYYY-MM-DD" },
          endDate: { type: "string", description: "YYYY-MM-DD" },
          question: {
            type: "string",
            description: "Only the part of the user's request that is about their calendar, in their own words. If they also asked about something else, leave that out."
          }
        },
        required: ["startDate", "endDate"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "query_tasks",
      description: "Answer a question ABOUT the user's tasks or to-dos, including whether they're behind on anything. Read-only — it only reports what is already there. Never use it to complete, move, or delete a task; those are modify_task, even when the request names a day.",

      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "Only the part of the user's request that is about their tasks or to-dos, in their own words. If they also asked about something else, leave that out."
          }
        }
      }

    }
  },


  {
    type: "function",
    function: {

      name: "save_note",
      description: "Write down a piece of information the user will want to look up later — a password, address, door code, phone number, business hours, a recommendation, a list, or something someone told them. Use this whenever the fact is about something EXTERNAL (a place, a thing, another person's info) rather than about the user's own personality, habits or preferences — 'the library closes at 10 on Fridays' is save_note even though the sentence starts with 'note that', because a library's hours aren't a fact about the user. The test is whether they'd later ask 'what was that again?'.",

      parameters: {
        type: "object",
        properties: {
          content: { type: "string" }
        },
        required: ["content"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "query_notes",
      description: "Answer a question using the user's previously saved notes. Use this whenever the user asks what they WROTE DOWN or NOTED about something — 'what did I write down about the marketing project' is query_notes, not query_projects, even though it names a project, because the question is about a note's content, not the project's status. query_projects is for 'how is it going' / 'what's next', not 'what did I say about it'.",

      parameters: {
        type: "object",
        properties: {
          question: { type: "string" }
        },
        required: ["question"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "start_deep_thinking",
      description: "Start a deep, structured analysis (pros/cons, breakdown, synthesis) on a significant question or decision the user is facing — e.g. 'should I take this job', 'break down whether to move to Austin'. Use only for substantial decisions, not quick questions. Takes noticeably longer than other tools; the full result is saved for the user to review on their dashboard, not read back immediately.",

      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "The decision or question to analyze, in the user's own words."
          }
        },
        required: ["topic"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "log_bodyweight",
      description: "Log a bodyweight entry, e.g. 'log my weight, 218 pounds' or 'weigh in at 217.5'.",

      parameters: {
        type: "object",
        properties: {
          weight: { type: "number" },
          unit: { type: "string", description: "Defaults to lbs if not specified." }
        },
        required: ["weight"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "sync_canvas",
      description: "Manually sync upcoming Canvas assignments into tasks, instead of waiting for the daily automatic sync.",

      parameters: {
        type: "object",
        properties: {}
      }

    }
  },


  {
    type: "function",
    function: {

      name: "save_intention",
      description: "Save something the user mentions wanting to do, try, read, build, or accomplish in the future — a goal, book, project idea, habit, anything forward-looking. Call this even when they don't explicitly ask you to remember it — if they say something like 'I've been meaning to...' or 'I should really...' or 'someday I want to...' in passing, capture it. Distinct from save_note (things to look up later) and save_memory (facts/preferences about the user).",

      parameters: {
        type: "object",
        properties: {
          content: { type: "string" }
        },
        required: ["content"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "query_projects",
      description: "Answer a question about the user's active projects — status, next actions, whether something looks behind schedule.",

      parameters: {
        type: "object",
        properties: {
          question: { type: "string" }
        },
        required: ["question"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "modify_task",
      description: "Change an existing to-do the user already has: mark it done, move its due date, or delete it. Use for things like 'I finished the marketing essay', 'mark laundry done', 'push the Costco cancellation to Friday', 'delete that reminder'. Identify the task by whatever words the user used — do not ask for an ID.",

      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "How the user referred to the task, in their own words."
          },
          action: {
            type: "string",
            enum: ["complete", "reschedule", "delete"],
            description: "'complete' when they say they did, finished, or handled it — including phrasings like 'I already cancelled Costco', where the task WAS to cancel Costco and is now done. 'reschedule' to move its due date ('push X to Friday'). 'delete' only when they want the reminder itself removed because it no longer applies — it discards the record, so prefer 'complete' whenever the thing actually got done."
          },
          year: { type: "integer" },
          month: { type: "integer" },
          day: { type: "integer" }
        },
        required: ["description", "action"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "modify_event",
      description: "Change an existing calendar event: move it to a different date or time, or cancel it. Use for things like 'move my dentist appointment to Thursday', 'push the coffee chat to 3pm', 'cancel the meeting with Reta'. Identify the event by whatever words the user used. Omit hour and minute when they only mention a new day — the original time is kept.",

      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "How the user referred to the event, in their own words."
          },
          action: {
            type: "string",
            enum: ["reschedule", "delete"],
            description: "'delete' for cancelling it entirely."
          },
          year: { type: "integer" },
          month: { type: "integer" },
          day: { type: "integer" },
          hour: { type: "integer", description: "24-hour. Omit if the user didn't mention a new time." },
          minute: { type: "integer", description: "Omit if the user didn't mention a new time." },
          durationMinutes: { type: "integer", description: "Only if they changed the length." }
        },
        required: ["description", "action"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "query_finances",
      description: "Answer anything about the user's money — balances, what they've been spending on, how much went out this month, whether a particular habit is costing them. Reads their real bank accounts. Use for 'how much did I spend on food', 'what's my balance', 'where is my money going', 'can I afford this'.",

      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The money question, in the user's own words."
          },
          days: {
            type: "integer",
            description: "How far back to look. Defaults to 30. Use 7 for 'this week', 90 for 'the last few months'."
          }
        },
        required: ["question"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "query_health",
      description: "Answer anything about the user's body, weight, cut or bulk progress, training, or diet — 'how's my cut going', 'what's my weight trend', 'am I on pace for my goal weight', 'analyze my progress'. Reads the FULL weigh-in history (start weight, current, pace), calorie log status, and stated goals. Always use this — never query_finances, query_notes or general_question — when the question concerns body composition, weight, or fitness progress. If the user is REPORTING a weigh-in ('I'm 216 today'), that is log_bodyweight instead.",

      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The health/body question, in the user's own words."
          }
        },
        required: ["question"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "general_question",
      // "using memory/context only" used to read as "has no data": the router
      // once rephrased a cut-analysis question into "...if I don't have the
      // user's exact stats?", and the answerer obediently disclaimed stats it
      // was holding. Say what the answerer actually has.
      description: "Answer a general question that no more specific query tool covers. The answerer already holds the user's profile, dated memories, live weigh-in trend, and cross-domain signals (money, follow-through, body, food, projects) — never assume its data is missing, and never rephrase the question to assert that. Body/fitness analysis goes to query_health, not here.",

      parameters: {
        type: "object",
        properties: {
          question: { type: "string" }
        },
        required: ["question"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "query_connections",
      description: "Answer a question about how things in the user's life are CONNECTED — what is linked to a person, project, place, merchant or spending category, or a vague reference like 'the thing with Priya' or 'whatever I've got going on with the internship'. Use this when the question is about relationships between things ('what's tied to', 'what's going on with', 'what's connected to', 'what do I have with X'), especially when the reference is oblique. Do NOT use it to look up a schedule, a to-do list, or a spending total — those are query_schedule/query_tasks/query_finances. Reads only the stored connection graph.",

      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The user's question, in their own words." }
        },
        required: ["question"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "research_query",
      description: "Search the live web for something that needs current, real-world information — not the model's static training data. Use for current prices/rates, real businesses or vendors, a person's public background before meeting or reaching out to them, or anything time-sensitive. Do NOT use for anything general_question or memory could already answer.",

      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The actual research question, specific enough to search well — not a vague topic."
          }
        },
        required: ["query"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "save_person",
      description: "Save or update DURABLE FACTS about a person the user knows: how they're related, an important date (birthday, anniversary), or how often to be reminded to check in with them. Updates the person if they already exist rather than duplicating them. Do NOT use this to record that a conversation or contact just happened — 'I called my mom today' or 'talked to Sarah' is log_contact, even though a person is named. This tool is for learning or changing something ABOUT a person, not for logging an interaction WITH one.",

      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          relationship: { type: "string", description: "e.g. 'college friend', 'coworker', 'aunt'. ONLY if he actually says how he knows them. Never guess, and never fill in a generic placeholder like 'contact', 'friend' or 'acquaintance' — this replaces whatever is already on file, so a guess erases a real answer." },
          notes: { type: "string", description: "The NEW fact worth remembering — how they met, what they do, what they just said. Send only what is new: this is added to what is already noted about them, so restating existing notes is unnecessary." },
          email: { type: "string" },
          phone: { type: "string" },
          check_in_days: {
            type: "integer",
            description: "How often, in days, to be nudged to check in — convert 'every two months' to ~60, 'once a week' to 7. Omit if not mentioned."
          },
          important_date_month: { type: "integer", description: "1-12. Omit if no date mentioned." },
          important_date_day: { type: "integer", description: "1-31. Omit if no date mentioned." },
          important_date_label: { type: "string", description: "e.g. 'birthday', 'work anniversary'. Only if a date was given." }
        },
        required: ["name"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "log_work",
      description: "Record what he did during a shift, day or session at a JOB or internship, so it accumulates into a record he can use later for LinkedIn posts, resume bullets and performance reviews. Use for 'today at work I...', 'just finished my shift, I edited...', 'first day at X, I did...'. This is the tool for WORK HE PERFORMED — it appends to a permanent, ordered log and is not the same as save_memory, which stores a standing fact. If he describes what he did at a job, use this, even if he also says something worth remembering.",

      parameters: {
        type: "object",
        properties: {
          org: { type: "string", description: "The employer or internship the work was for, e.g. 'Redbird Creative'." },
          content: { type: "string", description: "What he did, in HIS words and in full detail. Do not summarise, do not shorten, do not tidy — the detail is the whole point of storing it. Include every number he said." },
          occurred_at: { type: "string", description: "ISO date if he named a different day, e.g. yesterday. Omit for today." }
        },
        required: ["org", "content"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "query_work",
      description: "Answer a question about what he has DONE at a job or internship — 'what have I done for X so far', 'how many hours/pieces have I made', 'write me a LinkedIn post about my internship', 'what should go on my resume from this job'. Reads the complete work log in order. Use this and NOT query_projects whenever the question is about work performed at an employer; query_projects reads personal projects and cannot see the work log.",

      parameters: {
        type: "object",
        properties: {
          question: { type: "string" },
          org: { type: "string", description: "The employer, if he named one." }
        },
        required: ["question"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "query_people",
      description: "Answer a question about the user's saved relationships — who they know, when they last talked to someone, a person's details. Use for 'who do I know in marketing', 'when did I last talk to Sarah', 'tell me about my aunt'.",

      parameters: {
        type: "object",
        properties: {
          question: { type: "string" }
        },
        required: ["question"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "review_inbox",
      description: "Read the user's recent Gmail and report only what genuinely needs them \u2014 real replies owed, commitments made, and deadlines a message actually states. Use for 'what's in my inbox', 'anything I'm forgetting', 'did anyone need something from me', 'what did I miss this week'. This reads mail and can never send or delete it. Do NOT use it to write an email; that is draft_email.",

      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "How far back to look. Defaults to 7. Use a bigger number only if he asks about a longer stretch."
          },
          question: {
            type: "string",
            description: "Only if he asked something specific of the inbox, e.g. 'anything from Jon', 'did the landlord reply'."
          }
        },
        required: []
      }

    }
  },


  {
    type: "function",
    function: {

      name: "draft_email",
      description: "Write an email and save it as a Gmail DRAFT for the user to review. It is never sent — this tool cannot send mail, only draft it, so it is always safe to use. Use whenever the user wants an email written: 'draft an email to my professor asking for an extension', 'write Sarah an email about the trip'. The recipient can be a name — a saved person's address is looked up automatically. Do NOT use this for a note-to-self or a reminder; that's save_note or create_task.",

      parameters: {
        type: "object",
        properties: {
          about: {
            type: "string",
            description: "What the email needs to say, in the user's own words, including any specifics he gave (dates, amounts, reasons)."
          },
          to: {
            type: "string",
            description: "Who it's going to — a name ('my professor', 'Sarah') or an email address. Omit if he didn't say."
          },
          tone: {
            type: "string",
            description: "Only if he asked for one, e.g. 'formal', 'apologetic', 'short and direct'."
          }
        },
        required: ["about"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "export_to_doc",
      description: "Produce a real document and save it to Google Docs — a list, a prep sheet, a guide, a comparison, a set of questions. Use when the user wants something WRITTEN UP to read properly or send to someone: 'make me a list of interview questions for the Acme role and put it in a doc', 'write up a training plan and export it'. This produces a formatted multi-section document, which is what makes it different from save_note (a single fact to look up later) and from research_query (a spoken answer to a question). If the request needs current real-world information — a specific company, a real person, current prices or requirements — set research to true so it searches the web first instead of guessing.",

      parameters: {
        type: "object",
        properties: {
          request: {
            type: "string",
            description: "What the document should contain, in the user's own words, with every specific he gave (who, what role, what constraints)."
          },
          title: {
            type: "string",
            description: "Only if the user named the document himself. Otherwise omit and a title is written for it."
          },
          research: {
            type: "boolean",
            description: "True when the document depends on current, real-world specifics — a named company, a real person's background, current rates or requirements. False for something answerable from general knowledge."
          }
        },
        required: ["request"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "log_contact",
      description: "Record that the user just had contact with someone — a call, a text exchange, a visit, running into them. Resets their check-in clock. Use for ANY report that an interaction happened: 'I just talked to Sarah', 'caught up with my brother today', 'called my mom', 'saw my aunt this weekend'. This is the tool for something that already happened between the user and a person, even a brief or casual one — save_person is only for new/changed facts about the person, not for logging that contact occurred.",

      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The person's name, as saved." }
        },
        required: ["name"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "query_dining",
      description: "Answer a question about the campus dining hall menu — what's being served, what has the best macros, what fits a diet, what to eat: 'what's for dinner', 'is there good protein at lunch tomorrow', 'anything vegan tonight?'. Read-only. If the user wants meals SCHEDULED or a plan made, that is plan_meals; if they're reporting food already eaten, that is log_meal.",

      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The food question in the user's own words."
          },
          date: {
            type: "string",
            description: "YYYY-MM-DD, only when they asked about a specific day ('tomorrow', 'Friday'). Omit for today."
          }
        },
        required: ["question"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "plan_meals",
      description: "Build a meal plan from the dining hall menu and put the meals on the calendar: picks what to eat per meal from real menu items (honoring the user's dislikes and macro targets), finds an open time slot inside each meal window, and creates the events. 'Plan my meals today', 'figure out dinner', 'plan tomorrow's food around my classes'. Re-planning a meal replaces the old plan for it.",

      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "YYYY-MM-DD. Omit for today."
          },
          meals: {
            type: "array",
            items: { type: "string", enum: ["Breakfast", "Lunch", "Dinner"] },
            description: "Only the meals they asked about ('plan dinner' -> [\"Dinner\"]). Omit to plan every meal still ahead."
          },
          note: {
            type: "string",
            description: "Any extra steer they gave ('something light', 'high protein, I lifted today'). Omit otherwise."
          }
        }
      }

    }
  },


  {
    type: "function",
    function: {

      name: "log_meal",
      description: "Record what the user actually ATE — matches their words against the dining hall menu and logs calories and protein: 'I had the beef tips and mashed potatoes', 'two slices of pepperoni and a salad for lunch', 'just finished breakfast, eggs and oatmeal'. Past tense about food = this tool. Questions about food are query_dining; future food is plan_meals.",

      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "What they ate, in their own words, food words only."
          },
          meal: {
            type: "string",
            enum: ["Breakfast", "Lunch", "Dinner", "Snack"],
            description: "Only when they named the meal. Omit to infer from the time of day."
          },
          date: {
            type: "string",
            description: "YYYY-MM-DD, only when it wasn't today ('yesterday I had...'). Omit for today."
          }
        },
        required: ["description"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "set_food_preference",
      description: "Save a durable food preference that meal planning must respect: a food they dislike or refuse ('I don't like the pulled pork', 'never suggest tilapia'), something they love, a daily calorie or protein target ('aim for 140g of protein'), or a meal window ('I eat dinner between 5 and 7'). Use this instead of save_memory for anything about food, eating times, or nutrition targets — the meal planner reads THESE, not memories.",

      parameters: {
        type: "object",
        properties: {
          dislike: { type: "string", description: "A food/ingredient to never suggest." },
          like: { type: "string", description: "A food they enjoy." },
          remove: { type: "string", description: "A previously saved like/dislike to clear ('actually the pork is fine now')." },
          calorie_target: { type: "integer", description: "Daily calorie target." },
          protein_target: { type: "integer", description: "Daily protein target in grams." },
          meal: {
            type: "string",
            enum: ["Breakfast", "Lunch", "Dinner"],
            description: "Together with window_start/window_end when they gave eating hours."
          },
          window_start: { type: "string", description: "HH:mm, 24-hour." },
          window_end: { type: "string", description: "HH:mm, 24-hour." }
        }
      }

    }
  },


  {
    type: "function",
    function: {

      name: "open_on_laptop",
      description: "Open something on the user's laptop: a web search, a site, an application, or a local file. ONLY when the user EXPLICITLY names the laptop/computer as the destination — 'google X on my laptop', 'open premiere on my laptop', 'open my resume file on my computer'. NEVER volunteer this: if the laptop was not named, do not call it — an unexpected window opening on his machine (during an exam, a call, a screen-share) is genuinely harmful. Pair it freely with other tools when he asks for both ('draft the email and open it on my laptop' = draft_email + open_on_laptop).",

      parameters: {
        type: "object",
        properties: {
          search: {
            type: "string",
            description: "A web search to run, in his words ('espresso machines under 200')."
          },
          site: {
            type: "string",
            enum: ["gmail", "docs", "calendar", "drive"],
            description: "A known site to open, when he named one."
          },
          url: {
            type: "string",
            description: "An exact URL, only when he gave one or it is unambiguous."
          },
          app: {
            type: "string",
            description: "An application to launch, by its plain name as he said it: 'Premiere Pro', 'Messages', 'Spotify'."
          },
          file: {
            type: "string",
            description: "Words identifying a local file to find and open ('the ISU highlight project', 'my resume'). The laptop searches its own disk; nothing is guessed here."
          }
        }
      }

    }
  }

];
