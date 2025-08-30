// time_data_processor.js

/**
 * Reads configuration from the specified file and returns the settings.
 * @param {string} configPath The path to the configuration file.
 * @returns {object} The configuration object.
 */
async function getConfiguration(configPath) {
    console.log('Reading configuration from ' + configPath);
    try {
        const configFile = dv.pages(`"${configPath}"`).first();
        if (!configFile) {
            console.error(`Error: Configuration file not found at ${configPath}`);
            return {};
        }
        return configFile.file.frontmatter;
    } catch (error) {
        console.error(`Error reading configuration file: ${error.message}`);
        return {};
    }
}

/**
 * Processes daily note tables to create a structured time log.
 * @param {object} config The configuration object from the config file.
 * @returns {object} A nested object representing time spent per activity.
 */
async function processTimeLogs(config) {
    const timeData = {};
    const dailyNotesPath = config.dailyNotesPath;
    const timeField = config.timeField;
    const activityField = config.activityField;
    const hierarchyField = config.hierarchyField;
    const breakdownField = config.breakdownField;

    // 1. Find all daily notes with tables
    const dailyNotes = dv.pages(`"${dailyNotesPath}"`)
        .where(p => p.file.day && p.file.path.endsWith('.md'))
        .sort(p => p.file.day, 'asc');
    
    // 2. Iterate through each daily note
    for (const page of dailyNotes) {
        // Dataview's table() function is a bit difficult to parse directly.
        // A more reliable way is to find the raw text and parse the markdown table.
        const fileContent = await dv.io.load(page.file.path);
        const lines = fileContent.split('\n');
        
        let inTable = false;
        let headerRow = [];

        for (const line of lines) {
            // Check for the table start and end
            if (line.trim().startsWith('|') && line.includes('---')) {
                // This is the header separator line, so the next lines are data
                inTable = true;
                headerRow = lines[lines.indexOf(line) - 1].split('|').map(h => h.trim()).filter(Boolean);
                continue;
            }
            if (inTable && !line.trim().startsWith('|')) {
                // End of the table
                inTable = false;
                continue;
            }

            if (inTable) {
                const row = line.split('|').map(c => c.trim()).filter(Boolean);
                if (row.length === headerRow.length) {
                    const rowData = {};
                    headerRow.forEach((header, index) => {
                        rowData[header] = row[index];
                    });

                    // We now have the data for one row. Let's process it.
                    const activity = rowData[activityField];
                    const hierarchy = rowData[hierarchyField];
                    const breakdown = rowData[breakdownField];

                    // Calculate time spent. Each row represents 30 minutes (0.5 hours).
                    const duration = 0.5;

                    if (hierarchy) {
                        const categories = hierarchy.split('>').map(c => c.trim());
                        
                        let currentLevel = timeData;
                        for (let i = 0; i < categories.length; i++) {
                            const category = categories[i];
                            if (!currentLevel[category]) {
                                currentLevel[category] = {};
                            }

                            if (i === categories.length - 1) {
                                // We are at the last level of the hierarchy
                                // Check if there's a further breakdown
                                if (breakdown) {
                                    if (!currentLevel[category][breakdown]) {
                                        currentLevel[category][breakdown] = 0;
                                    }
                                    currentLevel[category][breakdown] += duration;
                                } else {
                                    if (typeof currentLevel[category] === 'object') {
                                        // This is a sub-category, not an activity
                                        // We need to decide what to do here. 
                                        // Let's assume the activity column is the final leaf node if breakdown is empty
                                        if (!currentLevel[category][activity]) {
                                            currentLevel[category][activity] = 0;
                                        }
                                        currentLevel[category][activity] += duration;
                                    } else {
                                        // This handles cases where a subcategory might not have a further breakdown.
                                        // Let's just add the time to the parent.
                                        currentLevel[category] += duration;
                                    }
                                }
                            } else {
                                currentLevel = currentLevel[category];
                            }
                        }
                    }
                }
            }
        }
    }
    return timeData;
}

// Expose the function for the main dashboard script to import
module.exports = { getConfiguration, processTimeLogs };