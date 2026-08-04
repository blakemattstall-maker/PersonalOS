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
      description: "Save a fact, preference, or note about the user to long-term memory.",

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
      description: "Answer any question about the user's calendar, schedule, events, or availability.",

      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "YYYY-MM-DD" },
          endDate: { type: "string", description: "YYYY-MM-DD" }
        },
        required: ["startDate", "endDate"]
      }

    }
  },


  {
    type: "function",
    function: {

      name: "query_tasks",
      description: "Answer any question about the user's tasks or to-dos, including whether they're behind on anything.",

      parameters: {
        type: "object",
        properties: {}
      }

    }
  },


  {
    type: "function",
    function: {

      name: "save_note",
      description: "Save a freeform note the user wants to write down and find later — distinct from a memory, which is a fact about the user's preferences used to personalize behavior.",

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
  }

];
