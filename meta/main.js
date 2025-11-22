import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import scrollama from 'https://cdn.jsdelivr.net/npm/scrollama@3.2.0/+esm';

let xScale, yScale;

async function loadData() {
  const data = await d3.csv('loc.csv', (row) => ({
    ...row,
    line: Number(row.line), // or just +row.line
    depth: Number(row.depth),
    length: Number(row.length),
    date: new Date(row.date + 'T00:00' + row.timezone),
    datetime: new Date(row.datetime),
  }));

  return data;
}

function processCommits(data) {
  const commits = d3
    .groups(data, (d) => d.commit)
    .map(([commit, lines]) => {
      let first = lines[0];
      let { author, date, time, timezone, datetime } = first;
      let ret = {
        id: commit,
        url: 'https://github.com/jacsea/portfolio/commit/' + commit,
        author,
        date,
        time,
        timezone,
        datetime,
        hourFrac: datetime.getHours() + datetime.getMinutes() / 60,
        totalLines: lines.length,
      };

      Object.defineProperty(ret, 'lines', {
        value: lines,
        writable: false,
        enumerable: true,
        configurable: true,
      });

      return ret;
    });

  // Sort commits by datetime ascending so plotting and updates keep a stable, chronological order.
  commits.sort((a, b) => a.datetime - b.datetime);

  return commits;
}

function renderCommitInfo(data, commits) {
  // Create the dl element
  const dl = d3.select('#stats').append('dl').attr('class', 'stats');

  // helper that creates a container for each stat so CSS can place them as cards
  function addStat(labelHtml, valueText) {
    const item = dl.append('div').attr('class', 'stat');
    item.append('dt').html(labelHtml);
    item.append('dd').text(valueText);
  }

  // Add total LOC
  addStat('Total <abbr title="Lines of code">LOC</abbr>', data.length);

  // Add total commits
  addStat('Total commits', commits.length);

  // Add total files
  const files = d3.rollup(
    data,
    (v) => v.length,
    (d) => d.file
  );
  addStat('Files', files.size);

  // Longest file
  const fileLengths = d3.rollup(
    data,
    (v) => v.length,
    (d) => d.file
  );
  const longestFile = Array.from(fileLengths).reduce((a, b) => (a[1] > b[1] ? a : b));
  addStat('Longest file', longestFile[1]);

  // Average file length (in characters)
  const avgFileLength = d3.mean(Array.from(fileLengths.values()));
  addStat('Average file length', Math.round(avgFileLength));

  // Time of day most work is done
  const timeOfDay = d3.rollup(
    data,
    (v) => v.length,
    (d) => {
      const hour = d.datetime.getHours();
      if (hour < 12) return 'Morning';
      if (hour < 18) return 'Afternoon';
      return 'Evening';
    }
  );
  const mostProductiveTime = Array.from(timeOfDay).reduce((a, b) => (a[1] > b[1] ? a : b));
  addStat('Time of day most work is done', mostProductiveTime[0]);
}

function renderScatterPlot(data, commits) {
    const [minLines, maxLines] = d3.extent(commits, (d) => d.totalLines);
    const sortedCommits = d3.sort(commits, (d) => -d.totalLines);
    const rScale = d3
        .scaleSqrt() // Change only this line
        .domain([minLines, maxLines])
        .range([2, 30]);
    const width = 1000;
    const height = 600;
    const svg = d3
        .select('#chart')
        .append('svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('fill', 'steelblue')
        .style('overflow', 'visible');
    xScale = d3
        .scaleTime()
        .domain(d3.extent(commits, (d) => d.datetime))
        .range([0, width])
        .nice();

    yScale = d3.scaleLinear().domain([0, 24]).range([height, 0]);
   
    const margin = { top: 10, right: 10, bottom: 30, left: 20 };

    const usableArea = {
        top: margin.top,
        right: width - margin.right,
        bottom: height - margin.bottom,
        left: margin.left,
        width: width - margin.left - margin.right,
        height: height - margin.top - margin.bottom,
    };

    // Update scales with new ranges
    xScale.range([usableArea.left, usableArea.right]);
    yScale.range([usableArea.bottom, usableArea.top]);

    // Add gridlines BEFORE the axes
    const gridlines = svg
        .append('g')
        .attr('class', 'gridlines')
        .attr('transform', `translate(${usableArea.left}, 0)`);

    // Create gridlines as an axis with no labels and full-width ticks
    gridlines.call(d3.axisLeft(yScale).tickFormat('').tickSize(-usableArea.width));

    // Create the axes
    const xAxis = d3.axisBottom(xScale);
    const yAxis = d3
        .axisLeft(yScale)
        .tickFormat((d) => String(d % 24).padStart(2, '0') + ':00');

    // Add X axis
    svg
        .append('g')
        .attr('transform', `translate(0, ${usableArea.bottom})`)
        .attr('class', 'x-axis')
        .call(xAxis);

    // Add Y axis
    svg
        .append('g')
        .attr('transform', `translate(${usableArea.left}, 0)`)
        .attr('class', 'y-axis')
        .call(yAxis);

    const brushGroup = svg.append('g').attr('class', 'brush');

    createBrushSelector(brushGroup);

    const dots = svg.append('g').attr('class', 'dots');

    dots
        .selectAll('circle')
        .data(sortedCommits, (d) => d.id)
        .join('circle')
        .attr('cx', (d) => xScale(d.datetime))
        .attr('cy', (d) => yScale(d.hourFrac))
        .attr('r', (d) => rScale(d.totalLines))
        .style('fill-opacity', 0.7)
        .on('mouseenter', (event, commit) => {
            d3.select(event.currentTarget).style('fill-opacity', 1.0);
            renderTooltipContent(commit);
            updateTooltipVisibility(true);
            updateTooltipPosition(event);
        })
        .on('mouseleave', () => {
            d3.selectAll('circle').style('fill-opacity', 0.7);
            updateTooltipVisibility(false);
       });
}

function createBrushSelector(svg) {
  svg.call(d3.brush().on('start brush end', brushed));
  svg.selectAll('.dots, .overlay ~ *').raise();
}

function brushed(event) {
  const selection = event.selection;
  d3.selectAll('circle').classed('selected', (d) =>
    isCommitSelected(selection, d),
  );
  renderSelectionCount(selection);
  renderLanguageBreakdown(selection);
}

function isCommitSelected(selection, commit) {
  if (!selection) {
    return false;
  }
  const [x0, x1] = selection.map((d) => d[0]);
  const [y0, y1] = selection.map((d) => d[1]);
  const x = xScale(commit.datetime);
  const y = yScale(commit.hourFrac);
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function renderSelectionCount(selection) {
  const selectedCommits = selection
    ? commits.filter((d) => isCommitSelected(selection, d))
    : [];

  const countElement = document.querySelector('#selection-count');
  countElement.textContent = `${
    selectedCommits.length || 'No'
  } commits selected`;

  return selectedCommits;
}

function renderLanguageBreakdown(selection) {
  const selectedCommits = selection
    ? commits.filter((d) => isCommitSelected(selection, d))
    : [];
  const container = document.getElementById('language-breakdown');

  if (selectedCommits.length === 0) {
    container.innerHTML = '';
    return;
  }
  const requiredCommits = selectedCommits.length ? selectedCommits : commits;
  const lines = requiredCommits.flatMap((d) => d.lines);

  // Use d3.rollup to count lines per language
  const breakdown = d3.rollup(
    lines,
    (v) => v.length,
    (d) => d.type,
  );

  // Update DOM with breakdown
  container.innerHTML = '';

  for (const [language, count] of breakdown) {
    const proportion = count / lines.length;
    const formatted = d3.format('.1~%')(proportion);

    container.innerHTML += `
            <dt>${language}</dt>
            <dd>${count} lines (${formatted})</dd>
        `;
  }
}

function renderTooltipContent(commit) {
  const link = document.getElementById('commit-link');
  const date = document.getElementById('commit-date');

  if (Object.keys(commit).length === 0) return;

  link.href = commit.url;
  link.textContent = commit.id;
  date.textContent = commit.datetime?.toLocaleString('en', {
    dateStyle: 'full',
  });
}

function updateTooltipVisibility(isVisible) {
  const tooltip = document.getElementById('commit-tooltip');
  tooltip.hidden = !isVisible;
}

function updateTooltipPosition(event) {
  const tooltip = document.getElementById('commit-tooltip');
  tooltip.style.left = `${event.clientX}px`;
  tooltip.style.top = `${event.clientY}px`;
}

let data = await loadData();
let commits = processCommits(data);

renderScatterPlot(data, commits);

renderCommitInfo(data, commits);

let commitProgress = 100;
let filteredCommits = commits;

function updateScatterPlot(data, commits) {
  const width = 1000;
  const height = 600;
  const margin = { top: 10, right: 10, bottom: 30, left: 20 };
  const usableArea = {
    top: margin.top,
    right: width - margin.right,
    bottom: height - margin.bottom,
    left: margin.left,
    width: width - margin.left - margin.right,
    height: height - margin.top - margin.bottom,
  };

  const svg = d3.select('#chart').select('svg');

  xScale = xScale.domain(d3.extent(commits, (d) => d.datetime));

  const [minLines, maxLines] = d3.extent(commits, (d) => d.totalLines);
  const rScale = d3.scaleSqrt().domain([minLines, maxLines]).range([2, 30]);

  const xAxis = d3.axisBottom(xScale);

  // CHANGE: we should clear out the existing xAxis and then create a new one.
  const xAxisGroup = svg.select('g.x-axis');
  xAxisGroup.selectAll('*').remove();
  xAxisGroup.call(xAxis);

  const dots = svg.select('g.dots');

  const sortedCommits = d3.sort(commits, (d) => -d.totalLines);
  dots
    .selectAll('circle')
    .data(sortedCommits, (d) => d.id)
    .join('circle')
    .attr('cx', (d) => xScale(d.datetime))
    .attr('cy', (d) => yScale(d.hourFrac))
    .attr('r', (d) => rScale(d.totalLines))
    .attr('fill', 'steelblue')
    .style('fill-opacity', 0.7) // Add transparency for overlapping dots
    .on('mouseenter', (event, commit) => {
      d3.select(event.currentTarget).style('fill-opacity', 1); // Full opacity on hover
      renderTooltipContent(commit);
      updateTooltipVisibility(true);
      updateTooltipPosition(event);
    })
    .on('mouseleave', (event) => {
      d3.select(event.currentTarget).style('fill-opacity', 0.7);
      updateTooltipVisibility(false);
    });
}

let timeScale = d3
  .scaleTime()
  .domain([
    d3.min(commits, (d) => d.datetime),
    d3.max(commits, (d) => d.datetime),
  ])
  .range([0, 100]);
let commitMaxTime = timeScale.invert(commitProgress);

const commitProgressInput = document.getElementById('commit-progress');
const commitTimeEl = document.getElementById('commit-time');

function onTimeSliderChange() {
  commitProgress = commitProgressInput ? Number(commitProgressInput.value) : 100;
  if (Number.isNaN(commitProgress)) commitProgress = 100;

  commitMaxTime = timeScale.invert(Math.max(0, Math.min(100, commitProgress)));

  if (commitTimeEl) {
    if (commitMaxTime && !Number.isNaN(commitMaxTime.getTime())) {
      commitTimeEl.textContent = commitMaxTime.toLocaleString();
    } else {
      commitTimeEl.textContent = '(any time)';
    }
  }
  filteredCommits = commits.filter(d => d.datetime <= commitMaxTime);
  updateScatterPlot(data, filteredCommits);
  updateFileDisplay();
}

if (commitProgressInput) commitProgressInput.addEventListener('input', onTimeSliderChange);

onTimeSliderChange();

// This code updates the div info
function updateFileDisplay(){
  let lines = filteredCommits.flatMap((d) => d.lines);
  let files = d3
    .groups(lines, (d) => d.file)
    .map(([name, lines]) => {
      return { name, lines };
    })
    .sort((a, b) => b.lines.length - a.lines.length);
  let colors = d3.scaleOrdinal(d3.schemeTableau10);

  let filesContainer = d3
    .select('#files')
    .selectAll('div')
    .data(files, (d) => d.name)
    .join(
      // This code only runs when the div is initially rendered
      (enter) =>
        enter.append('div').call((div) => {
          div.append('dt').append('code');
          div.append('dd');
        }),
    );
    // Put the filename and total lines together in the <dt>
    filesContainer.select('dt').html((d) => ` <code>${d.name}</code><small>${d.lines.length} lines</small>`);
    // Clear the <dd> (we show the total in the <dt> small tag)
    filesContainer.select('dd').text('');
    filesContainer
    .select('dd')
    .selectAll('div')
    .data((d) => d.lines)
    .join('div')
    .attr('class', 'loc')
    .attr('style', (d) => `--color: ${colors(d.type)}`);
  }

d3.select('#scatter-story')
  .selectAll('.step')
  .data(commits)
  .join('div')
  .attr('class', 'step')
  .html(
    (d, i) => `
		On ${d.datetime.toLocaleString('en', {
      dateStyle: 'full',
      timeStyle: 'short',
    })},
		I made <a href="${d.url}" target="_blank">${
      i > 0 ? 'another glorious commit' : 'my first commit, and it was glorious'
    }</a>.
		I edited ${d.totalLines} lines across ${
      d3.rollups(
        d.lines,
        (D) => D.length,
        (d) => d.file,
      ).length
    } files.
		Then I looked over all I had made, and I saw that it was very good.
	`,
  );

function onStepEnter(response) {
  // Log the full commit object when its step crosses the midpoint
  const commit = response.element.__data__;
  console.log(commit);

  // Update the time picker/slider and scatterplot to show commits up to this commit's datetime
  if (commit && commit.datetime) {
    // set commitMaxTime and slider percent using the same timeScale used elsewhere
    commitMaxTime = commit.datetime;
    const pct = Math.round(timeScale(commitMaxTime));
    commitProgress = pct;
    if (commitProgressInput) commitProgressInput.value = pct;
    if (commitTimeEl) commitTimeEl.textContent = commitMaxTime.toLocaleString();

    // filter commits up to the selected commit and update visuals
    filteredCommits = commits.filter((d) => d.datetime <= commitMaxTime);
    updateScatterPlot(data, filteredCommits);
    updateFileDisplay();
  }
}

const scroller = scrollama();
scroller
  .setup({
    container: '#scrolly-1',
    step: '#scrolly-1 .step',
  })
  .onStepEnter(onStepEnter);