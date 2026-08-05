export const TOOLS = [

  {
    type: "function",
    function: {

      name: "create_event",
      description: "Create a calendar event at a specific date and time.",

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
      description: "Save something about WHO THE USER IS — a preference, habit, trait, relationship, or personal circumstance — that should shape how you talk to them in future. Use only for facts about the person. Reference information they'd want to look up later (passwords, addresses, codes, recommendations) is save_note, not this.",

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
      description: "Write down a piece of information the user will want to look up later — a password, address, door code, phone number, recommendation, list, or something someone told them. The test is whether they'd later ask 'what was that again?'. Information to retrieve, not a fact about the user's own personality or preferences (that's save_memory).",

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
      description: "Answer a question using the user's previously saved notes.",

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
      description: "Save or update a person the user knows — a contact, not a fact about the user. Use whenever they mention someone by name with details worth remembering: how they're related, an important date (birthday, anniversary), or how often to be reminded to check in with them. Updates the person if they already exist rather than duplicating them.",

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

      name: "log_contact",
      description: "Record that the user just talked to, met, or reached out to someone already saved — resets their check-in clock. Use for 'I just talked to Sarah', 'caught up with my brother today'.",

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
