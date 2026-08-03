import { getEvents } from "../tools/googleCalendar.js";
import { getUserTimezone } from "../lib/profile.js";
import { DateTime } from "luxon";


export default async function handler(req, res) {

  try {

    const tz = await getUserTimezone();
    const now = DateTime.now().setZone(tz);


    const startDate = req.query.startDate
      || now.toFormat("yyyy-MM-dd");

    const endDate = req.query.endDate
      || now.plus({ days: 7 }).toFormat("yyyy-MM-dd");


    const result = await getEvents({
      startDate,
      endDate
    });


    return res.status(200).json(result);


  } catch (error) {

    return res.status(500).json({
      error: error.message
    });

  }

}