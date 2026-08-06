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
            description: "Only if the user asked for a specific colour. Omit otherwise — anything created here is red by default so it's identifiable."
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
      description: "Create a to-do task, optionally with a due date.",

      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          year: { type: "integer" },
          month: { type: "integer" },
          day: { type: "integer" },
          hour: { type: "integer" },
          minute: { type: "integer" }
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

      name: "general_question",
      description: "Answer a general question that is not about the calendar or tasks, using memory/context only.",

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
          relationship: { type: "string", description: "e.g. 'college friend', 'coworker', 'aunt'." },
          notes: { type: "string", description: "How they met, what they do, anything worth remembering." },
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
  }

];
