import { createEvent } from "../tools/googleCalendar";

export default async function handler(req, res) {

  const event = await createEvent(
    "PersonalOS Calendar Test",
    "2026-08-03T14:00:00-07:00",
    "2026-08-03T15:00:00-07:00",
    "Created through PersonalOS"
  );

  res.json(event);

}