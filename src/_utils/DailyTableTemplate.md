# Time Track
<%*
// Configure start and end times
const startHour = 0;   // 00:00 is the initial time
const endHour = 23;    // 23:30 is the last row
const increment = 30;  // 30-minute intervals

// Table header
let table = `| hh:mm | Activity | Fun | Meaning | Focus | Notes | Type |
| ----- | -------- | --- | ------- | ----- | ----- | ----- |
`;
// Loop through all time increments
for (let hour = startHour; hour <= endHour; hour++) {
  for (let minute = 0; minute < 60; minute += increment) {
    // Format hour/minute with leading zeros if needed
    let hh = hour.toString().padStart(2, '0');
    let mm = minute.toString().padStart(2, '0');

    table += `| ${hh}:${mm} |  |  |  |  |  |  |\n`;
  }
}

// Return the resulting table
tR += table;
%>