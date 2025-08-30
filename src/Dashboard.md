```dataviewjs
// --- Configuration ---
// Path to your daily notes folder. Ensure this matches your vault's structure.
const dailyNotesFolder = "examples";
// Format of your daily note file names (e.g., "2025-08-27").
const dailyNoteDateFormat = "YYYY-MM-DD";
// The header of the column that contains the full activity hierarchy (e.g., "Work > Project 1 > Debugging").
// This is assumed to be the *last* column in your table based on your new example.
const HIERARCHY_COLUMN_HEADER = "Type";
// Assumes each row in the table (after the 'hh:mm' column) represents a fixed duration.
const DURATION_PER_ROW_HOURS = 0.5;

// The previous TIME_FIELD, ACTIVITY_FIELD, and BREAKDOWN_FIELD constants are no longer
// used for building the hierarchy as the HIERARCHY_COLUMN_HEADER now provides all necessary info.
// They are commented out but kept for reference if your table structure ever changes back.
// const TIME_FIELD = "hh:mm";
// const ACTIVITY_FIELD = "Activity";
// const BREAKDOWN_FIELD = "Notes";


// --- Global State Variables ---
let timeData = {}; // This will hold our dynamically collected and nested time data
let topLevelTotals = {};
let grandTotal = 0;
let currentPeriod = "Today"; // Default selected period


// --- Helper Functions ---

/**
 * Helper function to recursively sum values in a nested object.
 * This is crucial for correctly totaling time from asymmetrical data structures.
 * @param {object | number} obj The object or numerical value to sum.
 * @returns {number} The total sum.
 */
function sumNestedValues(obj) {
    let sum = 0;
    if (typeof obj !== 'object' || obj === null) {
        return obj || 0; // Return value if not an object, default to 0
    }
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            sum += sumNestedValues(obj[key]);
        }
    }
    return sum;
}

/**
 * Calculates the start and end dates for a given period.
 * @param {string} period The selected time period (e.g., "This week", "7 days", "All").
 * @returns {{startDate: Date, endDate: Date}} An object containing the start and end dv.date() objects.
 */
function calculateDateRange(period) {
    const today = dv.date("now");
    let startDate = today.startOf('day');
    let endDate = today.endOf('day');

    switch (period) {
        case "Today":
            break; // Already set to today
        case "This week":
            startDate = today.startOf('week');
            endDate = today.endOf('week');
            break;
        case "This month":
            startDate = today.startOf('month');
            endDate = today.endOf('month');
            break;
        case "This year":
            startDate = today.startOf('year');
            endDate = today.endOf('year');
            break;
        case "7 days":
            startDate = today.minus({ days: 6 });
            break;
        case "30 days":
            startDate = today.minus({ days: 29 });
            break;
        case "12 weeks":
            startDate = today.minus({ weeks: 11 }).startOf('week');
            endDate = today.endOf('week'); // End this week for 12 weeks
            break;
        case "6 months":
            startDate = today.minus({ months: 5 }).startOf('month');
            endDate = today.endOf('month'); // End this month for 6 months
            break;
        case "1 year":
            startDate = today.minus({ years: 1 }).plus({ days: 1 }); // Approximately 1 year ago
            break;
        case "5 years":
            startDate = today.minus({ years: 5 }).plus({ days: 1 }); // Approximately 5 years ago
            break;
        case "All":
            startDate = dv.date("1900-01-01"); // Very old date to capture all
            endDate = dv.date("2100-01-01"); // Very far future date
            break;
    }
    return { startDate, endDate };
}


/**
 * Collects and processes time data from daily notes within a specified date range.
 * This function builds the nested timeData object dynamically based on the HIERARCHY_COLUMN_HEADER.
 * @param {Date} startDate The start date for filtering daily notes.
 * @param {Date} endDate The end date for filtering daily notes.
 * @returns {object} A nested object representing time spent per activity.
 */
async function collectAndProcessData(startDate, endDate) {
    const collectedTimeData = {};

    // Filter daily notes within the specified date range
    const dailyNotes = dv.pages(`"${dailyNotesFolder}"`)
        .where(p => p.file.day && p.file.day >= startDate && p.file.day <= endDate)
        .sort(p => p.file.day, 'asc');

    
    for (const page of dailyNotes) {

		try {
            const fileContent = await dv.io.load(page.file.path);
            const lines = fileContent.split('\n');

            let inTable = false;
            let headerRow = [];

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                // Detect table header separator line
                if (line.trim().startsWith('|') && line.includes('---')) {
                    inTable = true;
                    // The line before the separator is the actual header
                    headerRow = lines[i - 1].split('|').map(h => h.trim()).filter(Boolean);
                    i++; // Skip the separator line itself
                    continue;
                }

                // If we were in a table and current line is not a table line, table has ended
                if (inTable && !line.trim().startsWith('|')) {
                    inTable = false;
                    continue;
                }

                if (inTable) {
                    let row = line.split('|').map(c => c.trim());
                    // Trim empty start and ending arrays if they are null
	                let start = 0;
	                let end = row.length;
					while (start <= end && !row[start]) start++;
					while (end >= start && !row[end]) end--;
					if (start <= end) {

						row = row.slice(start, end+1)
					}
						// row = Arrays.copyOfRange(row, start, end + 1);
					// }
					
                    if (row.length === headerRow.length) {
                        const rowData = {};
                        headerRow.forEach((header, index) => {
                            rowData[header] = row[index];
                        });

                        const hierarchyString = rowData[HIERARCHY_COLUMN_HEADER];

                        if (hierarchyString && hierarchyString.trim() !== '') {
                            const pathSegments = hierarchyString.split('>').map(s => s.trim()).filter(Boolean);

                            if (pathSegments.length === 0) {
                                console.warn(`Row ignored: Empty hierarchy segments for string: "${hierarchyString}" in file: ${page.file.path}`);
                                continue;
                            }

                            const finalLeafName = pathSegments[pathSegments.length - 1]; // e.g., "Debugging"
                            const parentPathSegments = pathSegments.slice(0, -1); // e.g., ["Work", "Project 1"]

                            let currentLevel = collectedTimeData;
                            for (let j = 0; j < parentPathSegments.length; j++) {
                                const category = parentPathSegments[j];
                                if (!currentLevel[category]) {
                                    currentLevel[category] = {};
                                }
                                currentLevel = currentLevel[category];
                            }

                            // Add the final leaf node to the deepest level
                            if (!currentLevel[finalLeafName]) {
                                currentLevel[finalLeafName] = 0;
                            }
                            currentLevel[finalLeafName] += DURATION_PER_ROW_HOURS;
                        } else {
                            // If the HIERARCHY_COLUMN_HEADER column is empty for this row
                            console.warn(`Row ignored: "${HIERARCHY_COLUMN_HEADER}" column is empty for a row in file: ${page.file.path}. Row Data: ${JSON.stringify(rowData)}`);
                        }
                    } else {
                         console.warn(`Row ignored: Mismatch between header and row column count in file: ${page.file.path}. Header: ${headerRow.length}, Row: ${row.length}. Row Data: ${JSON.stringify(rowData)}`);
                    }
                }
            }
        } catch (error) {
            console.error(`Error loading or parsing file ${page.file.path}: ${error.message}`);
        }
    }
    return collectedTimeData;
}


// Generate random color for chart segments
// More perceptually accurate color interpolation using LAB color space
function getRandomColor(index, total) {
    // Hardcoded palette from the webpage
    const palette = [
        '#0A014F', // Federal blue
        '#3772FF', // Blue (Crayola)
        '#FFB627', // Selective yellow
        '#CF5C36', // Flame
        '#FF6700'  // Pumpkin
    ];
    
    // If total is less than or equal to palette length, return clipped palette
    if (total <= palette.length) {
        return palette[index];
    }
    
    // Helper functions for HSL conversion
    function hexToHsl(hex) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        
        if (max === min) {
            h = s = 0; // achromatic
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        
        return [h * 360, s * 100, l * 100];
    }
    
    function hslToHex(h, s, l) {
        h /= 360; s /= 100; l /= 100;
        
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        
        const r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
        const g = Math.round(hue2rgb(p, q, h) * 255);
        const b = Math.round(hue2rgb(p, q, h - 1/3) * 255);
        
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }
    
    // Calculate which segment we're in
    const segmentSize = (total - 1) / (palette.length - 1);
    const segmentIndex = Math.floor(index / segmentSize);
    const segmentProgress = (index % segmentSize) / segmentSize;
    
    // Handle edge case for last index
    if (segmentIndex >= palette.length - 1) {
        return palette[palette.length - 1];
    }
    
    // Get the two colors to interpolate between
    const color1 = hexToHsl(palette[segmentIndex]);
    const color2 = hexToHsl(palette[segmentIndex + 1]);
    
    // Interpolate in HSL space
    // Handle hue wraparound for shortest path
    let h1 = color1[0], h2 = color2[0];
    if (Math.abs(h2 - h1) > 180) {
        if (h1 > h2) h2 += 360;
        else h1 += 360;
    }
    
    const interpolatedH = (h1 + (h2 - h1) * segmentProgress) % 360;
    const interpolatedS = color1[1] + (color2[1] - color1[1]) * segmentProgress;
    const interpolatedL = color1[2] + (color2[2] - color1[2]) * segmentProgress;
    
    return hslToHex(interpolatedH, interpolatedS, interpolatedL);
}
// --- UI Element Creation ---
const container = this.container;
container.empty(); // Clear previous content if rerunning
container.id = "dashboard-container";
container.style.width = "100%";
container.style.height = "auto";
container.style.display = "flex";
container.style.flexDirection = "column";
container.style.alignItems = "center";
container.style.fontFamily = "Inter, sans-serif"; // Using Inter font

// Control row for period selector and home button
const controlRow = container.createEl("div");
controlRow.style.marginBottom = "20px";
controlRow.style.width = "100%";
controlRow.style.textAlign = "center";
controlRow.style.display = "flex";
controlRow.style.justifyContent = "center";
controlRow.style.alignItems = "center";
controlRow.style.gap = "10px"; // Space between elements

// Period Dropdown Menu
const periodSelect = controlRow.createEl("select");
periodSelect.id = "period-select";
periodSelect.style.padding = "8px 12px";
periodSelect.style.borderRadius = "8px";
periodSelect.style.border = "1px solid #4c566a";
periodSelect.style.backgroundColor = "#3b4252";
periodSelect.style.color = "#eceff4";
periodSelect.style.cursor = "pointer";
periodSelect.style.boxShadow = "0 2px 4px rgba(0,0,0,0.1)";

const periods = [
    "Today", "This week", "This month", "This year",
    "7 days", "30 days", "12 weeks", "6 months", "1 year", "5 years", "All"
];
periods.forEach(p => {
    const option = periodSelect.createEl("option", { text: p, value: p });
    if (p === currentPeriod) {
        option.selected = true;
    }
});

periodSelect.onchange = async (event) => {
    currentPeriod = event.target.value;
    await showMainView(); // Re-render with new data based on selected period
};

// Home Button
const homeBtn = controlRow.createEl("button");
homeBtn.textContent = "Time Overview";
homeBtn.style.padding = "8px 16px";
homeBtn.style.backgroundColor = "#5e81ac"; // Obsidian accent color
homeBtn.style.color = "white";
homeBtn.style.border = "none";
homeBtn.style.borderRadius = "8px"; // Rounded corners
homeBtn.style.cursor = "pointer";
homeBtn.style.boxShadow = "0 4px 6px rgba(0,0,0,0.1)"; // Subtle shadow
homeBtn.style.transition = "background-color 0.3s ease, box-shadow 0.3s ease"; // Smooth transition

homeBtn.onmouseover = () => homeBtn.style.backgroundColor = "#88c0d0"; // Hover effect
homeBtn.onmouseout = () => homeBtn.style.backgroundColor = "#5e81ac"; // Reset effect

// Create title for the current view
const title = container.createEl("h2");
title.id = "view-title";
title.textContent = "Overall Time Distribution";
title.style.marginBottom = "20px";
title.style.color = "#eceff4"; // Light text for dark themes

// Create breadcrumb navigation
const breadcrumb = container.createEl("div");
breadcrumb.id = "breadcrumb";
breadcrumb.style.marginBottom = "20px";
breadcrumb.style.display = "none"; // Hidden by default
breadcrumb.style.color = "#d8dee9";

// Create chart container
const chartContainer = container.createEl("div");
chartContainer.id = "chart-container";
chartContainer.style.width = "100%";
chartContainer.style.maxWidth = "600px"; // Limit chart width for better appearance
chartContainer.style.height = "300px"; // Fixed height for chart
chartContainer.style.marginBottom = "30px";
chartContainer.style.backgroundColor = "#2e3440"; // Dark background for chart
chartContainer.style.borderRadius = "12px"; // More rounded corners
chartContainer.style.padding = "15px";
chartContainer.style.boxShadow = "0 8px 16px rgba(0,0,0,0.2)";

// Create details section (summary table)
const detailsSection = container.createEl("div");
detailsSection.id = "details-section";
detailsSection.style.width = "100%";
detailsSection.style.maxWidth = "700px"; // Max width for the table
detailsSection.style.marginTop = "20px";
detailsSection.style.backgroundColor = "#3b4252"; // Slightly lighter dark background
detailsSection.style.borderRadius = "12px";
detailsSection.style.padding = "20px";
detailsSection.style.boxShadow = "0 8px 16px rgba(0,0,0,0.2)";

/**
 * Renders a chart using the Obsidian Charts plugin.
 * @param {Array<number>} data Values for the chart.
 * @param {Array<string>} labels Labels for the chart segments/bars.
 * @param {'doughnut' | 'bar'} chartType Type of chart to render.
 * @param {function} onClickHandler Function to call when a chart segment/bar is clicked.
 * @param {number} totalForPercentage The total value to calculate percentages against in tooltips.
 * @param {Array<string>} currentPath An array representing the current drill-down path.
 */
function renderChart(data, labels, chartType, onClickHandler, totalForPercentage, currentPath = []) {
    const chartConfig = {
        type: chartType,
        data: {
            labels: labels,
            datasets: [{
                label: 'Time (hours)',
                data: data,
			backgroundColor: labels.map((_, i) => {
			    const hexColor = getRandomColor(i, labels.length);
			    // Convert hex to RGBA with desired alpha
			    const r = parseInt(hexColor.slice(1, 3), 16);
			    const g = parseInt(hexColor.slice(3, 5), 16);
			    const b = parseInt(hexColor.slice(5, 7), 16);
			    return `rgba(${r}, ${g}, ${b}, 0.4)`; // 0.6 is 60% opacity
			}),
                borderColor: labels.map((_, i) => {
			    const hexColor = getRandomColor(i, labels.length);
			    // Convert hex to RGBA with desired alpha
			    const r = parseInt(hexColor.slice(1, 3), 16);
			    const g = parseInt(hexColor.slice(3, 5), 16);
			    const b = parseInt(hexColor.slice(5, 7), 16);
			    return `rgba(${r}, ${g}, ${b}, 1)`; // 0.6 is 60% opacity
			}),
                borderWidth: 1
            }]
        },
        options: {
            onClick: (e, elements) => {
                if (elements.length > 0 && onClickHandler) {
                    const index = elements[0].index;
                    const clickedLabel = labels[index];
                    onClickHandler(clickedLabel, ...currentPath); // Pass current path for deeper drill
                }
            },
            cutout: '75%',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#d8dee9'
                    }
                },
                title: {
                    display: false,
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed;
                            const percentage = ((value / totalForPercentage) * 100).toFixed(1);
                            return `${label}: ${value.toFixed(1)} hours (${percentage}%)`;
                        }
                    }
                }
            }
        }
    };
    
    chartContainer.empty();
    window.renderChart(chartConfig, chartContainer);
}

/**
 * Renders the main dashboard view, including the donut chart and summary table.
 */
async function showMainView() {
    title.textContent = "Overall Time Distribution";
    breadcrumb.style.display = "none"; // Hide breadcrumb on main view

    // Collect data for the selected period
    const { startDate, endDate } = calculateDateRange(currentPeriod);
    timeData = await collectAndProcessData(startDate, endDate);

    // Recalculate top-level totals and grand total based on new timeData
    topLevelTotals = {};
    grandTotal = 0;
    for (const category in timeData) {
        if (Object.prototype.hasOwnProperty.call(timeData, category)) {
            const categoryTotal = sumNestedValues(timeData[category]);
            topLevelTotals[category] = categoryTotal;
            grandTotal += categoryTotal;
        }
    }

    // Prepare data for the donut chart
    const labels = Object.keys(topLevelTotals);
    const values = Object.values(topLevelTotals);
    renderChart(values, labels, 'doughnut', showSubcategories, grandTotal);

    // Render the summary table
    detailsSection.empty();
    const summaryTableEl = detailsSection.createEl("table");
    summaryTableEl.style.width = "100%";
    summaryTableEl.style.borderCollapse = "collapse";

    const tableHeaderEl = summaryTableEl.createEl("thead");
    const headerRowEl = tableHeaderEl.createEl("tr");
    headerRowEl.createEl("th", { text: "Category", cls: "table-header" }).style.textAlign = "left";
    headerRowEl.createEl("th", { text: "Time (hours)", cls: "table-header" }).style.textAlign = "right";
    headerRowEl.createEl("th", { text: "Percentage", cls: "table-header" }).style.textAlign = "right";

    const tableBodyEl = summaryTableEl.createEl("tbody");

    if (labels.length === 0) {
        const noDataRow = tableBodyEl.createEl("tr", {cls: "table-row"});
        noDataRow.createEl("td", { text: "No data available for this period.", cls: "table-cell", attr: { colspan: 3 } }).style.textAlign = "center";
    } else {
        Object.keys(topLevelTotals).forEach(category => {
            const rowEl = tableBodyEl.createEl("tr", {cls: "table-row"});
            rowEl.style.cursor = "pointer"; // Make rows clickable
            rowEl.addEventListener("click", () => showSubcategories(category));
            rowEl.createEl("td", { text: category, cls: "table-cell" }).style.textAlign = "left";
            rowEl.createEl("td", { text: topLevelTotals[category].toFixed(1), cls: "table-cell" }).style.textAlign = "right";
            const percent = (topLevelTotals[category] / grandTotal * 100).toFixed(1);
            rowEl.createEl("td", { text: `${percent}%`, cls: "table-cell" }).style.textAlign = "right";
        });

        const totalRowEl = tableBodyEl.createEl("tr", {cls: "table-total-row"});
        totalRowEl.createEl("td", { text: "Total", cls: "table-total-cell" }).style.textAlign = "left";
        totalRowEl.createEl("td", { text: grandTotal.toFixed(1), cls: "table-total-cell" }).style.textAlign = "right";
        totalRowEl.createEl("td", { text: "100.0%", cls: "table-total-cell" }).style.textAlign = "right";
    }

    // Basic inline styles for table elements (can be moved to CSS snippet later)
    const tableStyles = `
        .table-header { padding: 12px 8px; border-bottom: 2px solid #4c566a; color: #eceff4; font-weight: bold; background-color: #434c5e; }
        .table-row td { padding: 10px 8px; border-bottom: 1px solid #4c566a; color: #e5e9f0; }
        .table-row:nth-child(even) { background-color: #3b4252; }
        .table-row:nth-child(odd) { background-color: #2e3440; }
        .table-total-row td { padding: 12px 8px; border-top: 2px solid #88c0d0; font-weight: bold; color: #eceff4; background-color: #434c5e; }
        #breadcrumb a { color: #88c0d0; text-decoration: none; cursor: pointer; }
        #breadcrumb a:hover { text-decoration: underline; }
    `;
    const styleEl = container.createEl("style", { text: tableStyles });
}

/**
 * Shows the subcategories for a given parent category.
 * @param {string} category The parent category to drill down into.
 */
function showSubcategories(category) {
    title.textContent = `${category} Breakdown`;

    // Update breadcrumb
    breadcrumb.style.display = "block";
    breadcrumb.empty();
    const homeLink = breadcrumb.createEl("a", { text: "Home" });
    homeLink.onclick = showMainView;
    breadcrumb.createEl("span", { text: " > " });
    breadcrumb.createEl("span", { text: category, style: "font-weight: bold; color: #eceff4;" });

    // Get subcategories data and prepare for chart/table
    const currentCategoryData = timeData[category];
    const subcategoriesForView = {};
    let currentTotal = 0;

    if (typeof currentCategoryData === 'object' && currentCategoryData !== null) {
        for (const subItem in currentCategoryData) {
            if (Object.prototype.hasOwnProperty.call(currentCategoryData, subItem)) {
                const subItemData = currentCategoryData[subItem];
                const sum = sumNestedValues(subItemData); // Sum all values for the sub-item
                subcategoriesForView[subItem] = sum;
                currentTotal += sum;
            }
        }
    }

    const labels = Object.keys(subcategoriesForView);
    const values = Object.values(subcategoriesForView);

    // Render doughnut chart for subcategories
    renderChart(values, labels, 'doughnut', (clickedLabel) => showDetails(clickedLabel, category), currentTotal, [category]);

    // Render the details table for subcategories
    detailsSection.empty();
    const detailsTable = detailsSection.createEl("table");
    detailsTable.style.width = "100%";
    detailsTable.style.borderCollapse = "collapse";

    const tableHeader = detailsTable.createEl("thead");
    const headerRow = tableHeader.createEl("tr");
    headerRow.createEl("th", { text: "Subcategory", cls: "table-header" }).style.textAlign = "left";
    headerRow.createEl("th", { text: "Time (hours)", cls: "table-header" }).style.textAlign = "right";
    headerRow.createEl("th", { text: "Percentage", cls: "table-header" }).style.textAlign = "right";

    const tableBody = detailsTable.createEl("tbody");

    if (labels.length === 0) {
        const noDataRow = tableBody.createEl("tr", {cls: "table-row"});
        noDataRow.createEl("td", { text: "No data available for this category.", cls: "table-cell", attr: { colspan: 3 } }).style.textAlign = "center";
    } else {
        Object.keys(subcategoriesForView).forEach(subCat => {
            const row = tableBody.createEl("tr", {cls: "table-row"});
            // Check if this subcategory itself is an object in timeData, if so, it's clickable for deeper drill
            const originalSubCatData = timeData[category]?.[subCat];
            if (typeof originalSubCatData === 'object' && originalSubCatData !== null) {
                row.style.cursor = "pointer";
                row.addEventListener("click", () => showDetails(subCat, category));
            }
            
            row.createEl("td", { text: subCat, cls: "table-cell" }).style.textAlign = "left";
            row.createEl("td", { text: subcategoriesForView[subCat].toFixed(1), cls: "table-cell" }).style.textAlign = "right";
            const percent = (subcategoriesForView[subCat] / currentTotal * 100).toFixed(1);
            row.createEl("td", { text: `${percent}%`, cls: "table-cell" }).style.textAlign = "right";
        });
    }
}

/**
 * Shows the detailed breakdown of activities within a specific subcategory.
 * This function handles the "second level" drill-down.
 * @param {string} subcategory The subcategory to drill down into (e.g., "Habit", "Physics").
 * @param {string} parentCategory The parent category (e.g., "Personal time").
 */
function showDetails(subcategory, parentCategory) {
    const detailsData = timeData[parentCategory]?.[subcategory];

    if (typeof detailsData !== 'object' || detailsData === null) {
        // If it's a leaf node or doesn't exist, go back to the parent view (subcategory breakdown)
        showSubcategories(parentCategory);
        return;
    }
    
    title.textContent = `${subcategory} Activities`;

    // Update breadcrumb
    breadcrumb.style.display = "block";
    breadcrumb.empty();
    const homeLink = breadcrumb.createEl("a", { text: "Home" });
    homeLink.onclick = showMainView;
    breadcrumb.createEl("span", { text: " > " });
    const parentLink = breadcrumb.createEl("a", { text: parentCategory });
    parentLink.onclick = () => showSubcategories(parentCategory);
    breadcrumb.createEl("span", { text: " > " });
    breadcrumb.createEl("span", { text: subcategory, style: "font-weight: bold; color: #eceff4;" });

    const labels = [];
    const values = [];
    let currentTotal = 0;

    for (const activityName in detailsData) {
        if (Object.prototype.hasOwnProperty.call(detailsData, activityName)) {
            const activityValue = sumNestedValues(detailsData[activityName]); // Sum all values for this activity
            labels.push(activityName);
            values.push(activityValue);
            currentTotal += activityValue;
        }
    }

    // Render doughnut chart for activities
    // Pass the full path for deeper drill-down to the next level
    renderChart(values, labels, 'doughnut', (clickedLabel) => showDeepDetails(clickedLabel, subcategory, parentCategory), currentTotal, [parentCategory, subcategory]);

    // Render the details table for activities
    detailsSection.empty();
    const detailsTable = detailsSection.createEl("table");
    detailsTable.style.width = "100%";
    detailsTable.style.borderCollapse = "collapse";

    const tableHeader = detailsTable.createEl("thead");
    const headerRow = tableHeader.createEl("tr");
    headerRow.createEl("th", { text: "Activity", cls: "table-header" }).style.textAlign = "left";
    headerRow.createEl("th", { text: "Time (hours)", cls: "table-header" }).style.textAlign = "right";
    headerRow.createEl("th", { text: "Percentage", cls: "table-header" }).style.textAlign = "right";

    const tableBody = detailsTable.createEl("tbody");

    if (labels.length === 0) {
        const noDataRow = tableBody.createEl("tr", {cls: "table-row"});
        noDataRow.createEl("td", { text: "No data available for this breakdown.", cls: "table-cell", attr: { colspan: 3 } }).style.textAlign = "center";
    } else {
        labels.forEach((activity, index) => {
            const row = tableBody.createEl("tr", {cls: "table-row"});
            // Check if this activity itself is an object for deeper drill-down
            const originalActivityData = detailsData[activity];
            if (typeof originalActivityData === 'object' && originalActivityData !== null) {
                row.style.cursor = "pointer";
                row.addEventListener("click", () => showDeepDetails(activity, subcategory, parentCategory));
            }

            row.createEl("td", { text: activity, cls: "table-cell" }).style.textAlign = "left";
            row.createEl("td", { text: values[index].toFixed(1), cls: "table-cell" }).style.textAlign = "right";
            const percent = (values[index] / currentTotal * 100).toFixed(1);
            row.createEl("td", { text: `${percent}%`, cls: "table-cell" }).style.textAlign = "right";
        });
    }
}

/**
 * Shows the deepest level of breakdown for an activity that was itself an object.
 * @param {string} deepActivity The deepest activity (e.g., "StatPhys").
 * @param {string} subcategory The parent subcategory (e.g., "Physics").
 * @param {string} topCategory The top-level category (e.g., "Personal time").
 */
function showDeepDetails(deepActivity, subcategory, topCategory) {
    const deepestData = timeData[topCategory]?.[subcategory]?.[deepActivity];

    if (typeof deepestData !== 'object' || deepestData === null) {
        // If it's a leaf node or doesn't exist, go back to the parent view
        showDetails(subcategory, topCategory);
        return;
    }

    title.textContent = `${deepActivity} Breakdown`;

    // Update breadcrumb
    breadcrumb.style.display = "block";
    breadcrumb.empty();
    const homeLink = breadcrumb.createEl("a", { text: "Home" });
    homeLink.onclick = showMainView;
    breadcrumb.createEl("span", { text: " > " });
    const topCatLink = breadcrumb.createEl("a", { text: topCategory });
    topCatLink.onclick = () => showSubcategories(topCategory);
    breadcrumb.createEl("span", { text: " > " });
    const subCatLink = breadcrumb.createEl("a", { text: subcategory });
    subCatLink.onclick = () => showDetails(subcategory, topCategory);
    breadcrumb.createEl("span", { text: " > " });
    breadcrumb.createEl("span", { text: deepActivity, style: "font-weight: bold; color: #eceff4;" });

    const labels = Object.keys(deepestData);
    const values = Object.values(deepestData);
    const currentTotal = values.reduce((sum, val) => sum + val, 0);

    // Render doughnut chart for deepest activities (no further drill down from here)
    renderChart(values, labels, 'doughnut', null, currentTotal, [topCategory, subcategory, deepActivity]);

    // Render the details table for deepest activities
    detailsSection.empty();
    const detailsTable = detailsSection.createEl("table");
    detailsTable.style.width = "100%";
    detailsTable.style.borderCollapse = "collapse";

    const tableHeader = detailsTable.createEl("thead");
    const headerRow = tableHeader.createEl("tr");
    headerRow.createEl("th", { text: "Sub-Activity", cls: "table-header" }).style.textAlign = "left";
    headerRow.createEl("th", { text: "Time (hours)", cls: "table-header" }).style.textAlign = "right";
    headerRow.createEl("th", { text: "Percentage", cls: "table-header" }).style.textAlign = "right";

    const tableBody = detailsTable.createEl("tbody");

    if (labels.length === 0) {
        const noDataRow = tableBody.createEl("tr", {cls: "table-row"});
        noDataRow.createEl("td", { text: "No data available for this breakdown.", cls: "table-cell", attr: { colspan: 3 } }).style.textAlign = "center";
    } else {
        labels.forEach((activity, index) => {
            const row = tableBody.createEl("tr", {cls: "table-row"});
            row.createEl("td", { text: activity, cls: "table-cell" }).style.textAlign = "left";
            row.createEl("td", { text: values[index].toFixed(1), cls: "table-cell" }).style.textAlign = "right";
            const percent = (values[index] / currentTotal * 100).toFixed(1);
            row.createEl("td", { text: `${percent}%`, cls: "table-cell" }).style.textAlign = "right";
        });
    }
}

// Add event listener to the home button to re-render the main view
homeBtn.addEventListener("click", showMainView);

// Initialize the main view when the script loads
showMainView();
```














