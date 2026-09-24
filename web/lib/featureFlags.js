// Deliberately static so retired features disappear from server bundles and
// cannot spend compute because a stored setting or old Shortcut still points
// at them. Their code and data remain intact for an intentional restoration.
export const FOOD_ENABLED = false;
export const JOBS_ENABLED = false;

export const FOOD_RETIRED_MESSAGE = "Food tracking has moved to its own app.";
export const JOBS_PAUSED_MESSAGE = "Internship monitoring is paused.";
