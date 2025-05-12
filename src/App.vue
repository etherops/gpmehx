<template>
  <div class="app-container">
    <h1>gpMEHx: the very very meh GPX editor</h1>
    <div class="editor-container">
      <div class="gpx-editor">
        <div class="map-container">
          <div id="map" ref="mapRef"></div>
        </div>
        <div class="track-list">
          <h3>Track Points</h3>
          <div class="track-points-container">
            <div v-if="!trackpoints.length" class="no-data-message">
              No track points available. Upload a GPX file to view track points.
            </div>
            <div
              v-else
              v-for="(point, index) in trackpoints"
              :key="index"
              :ref="el => { if (el) trackPointRefs[index] = el }"
              class="track-point"
              :class="{
                selected: selectedPoints.includes(index),
                highlighted: hoveredPointIndex === index
              }"
              @click="togglePointSelection(index)"
            >
              <span class="point-index">{{ index + 1 }}</span>
              <span class="point-time">{{ formatTime(point.time) }}</span>
              <span class="point-coords">
                <span class="metadata-label">Lat:</span>
                <span class="metadata-value">{{ point.lat.toFixed(5) }}</span>
                <span class="metadata-label">Lon:</span>
                <span class="metadata-value">{{ point.lon.toFixed(5) }}</span>
              </span>
              <span class="point-elevation" v-if="point.ele">
                <span class="metadata-label">Ele:</span>
                <span class="metadata-value">{{ point.ele.toFixed(1) }}m</span>

                <!-- Show elevation difference if not the first point -->
                <span class="metadata-label" v-if="index > 0">Δ Ele:</span>
                <span class="metadata-value elevation-change" v-if="index > 0"
                  :class="{
                    'positive': point.ele > trackpoints[index-1].ele,
                    'negative': point.ele < trackpoints[index-1].ele
                  }">
                  {{ (point.ele - trackpoints[index-1].ele).toFixed(1) }}m
                </span>
              </span>
              <span class="point-status">
                <span v-if="isSegmentStart(index)" class="segment-indicator">SEGMENT START</span>
                <span v-else-if="isSegmentEnd(index)" class="segment-indicator">SEGMENT END</span>
              </span>
            </div>
          </div>
        </div>
        <div class="controls-panel">
          <div class="controls">
            <div class="track-info">
              <h3>Track Information</h3>
              <p>Total Points: {{ trackpoints.length }}</p>
              <p>Selected Points: {{ selectedPoints.length }}</p>
              <div class="file-upload-controls">
                <h4>Upload GPX File</h4>
                <input type="file" accept=".gpx" @change="handleFileUpload" />
              </div>
            </div>
            <div class="selection-controls">
              <h3>Selection</h3>
              <button @click="clearSelection" :disabled="!trackpoints.length">Clear Selection</button>
              <button @click="markAsPaused" :disabled="!selectedPoints.length">Mark Selected as Paused</button>
              <p class="area-selection-help">
                Draw a rectangle on the map to select all points within that area.
              </p>
              <div class="pause-info">
                <p><strong>Note:</strong> Selected points will be <em>immediately removed</em> when marked as paused.</p>
                <p>Strava will recognize the gaps between points as pauses in your activity.</p>
              </div>
            </div>
            <div class="export-controls">
              <h3>Export</h3>
              <button @click="exportGpx" :disabled="!gpxData">Export GPX</button>
            </div>
          </div>
        </div>
        <div class="elevation-graph" ref="elevationGraphRef" @mousemove="handleElevationGraphHover" @mouseleave="handleElevationGraphLeave">
          <h3>Elevation Profile</h3>
          <div class="graph-container" ref="graphContainerRef"></div>
        </div>
        <div class="debug-panel">
          <h3>Track Point Debug View</h3>
          <div class="debug-panel-content">
            <div v-if="!selectedPoints.length" class="no-data-message">
              No track points selected. Select points to view debug information.
            </div>
            <div v-else class="selected-points-debug">
              <div v-for="pointIndex in selectedPoints" :key="pointIndex" class="debug-point">
                <div class="debug-point-header">
                  <h4>Point {{ pointIndex + 1 }}</h4>
                </div>
                <pre class="debug-xml">{{ getRawTrackPointXml(pointIndex) }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, nextTick, watch } from 'vue';
import L from 'leaflet';
import 'leaflet-draw';
// Fix for leaflet-draw "type is not defined" error
window.type = true; // Global declaration of type variable needed by leaflet-draw

export default {
  name: 'App',
  setup() {
    const gpxData = ref(null);
    const trackpoints = ref([]);
    const selectedPoints = ref([]);
    const pausedPoints = ref([]);
    const mapRef = ref(null);
    const isAreaSelectionMode = ref(true); // Always in area selection mode
    const hoveredPointIndex = ref(null);
    const elevationGraphRef = ref(null);
    const graphContainerRef = ref(null);
    const trackPointRefs = ref({});
    const debugPointIndex = ref(null); // Track point index for debug view
    let map = null;
    let trackLayer = null;
    let markers = [];
    let drawControl = null;
    let rectangleLayer = null;
    let elevationChart = null;

    // Parse GPX file
    const parseGpx = (gpxContent) => {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(gpxContent, "text/xml");
      const trkpts = xmlDoc.getElementsByTagName("trkpt");

      const points = [];
      for (let i = 0; i < trkpts.length; i++) {
        const trkpt = trkpts[i];
        const lat = parseFloat(trkpt.getAttribute("lat"));
        const lon = parseFloat(trkpt.getAttribute("lon"));
        const ele = parseFloat(trkpt.getElementsByTagName("ele")[0]?.textContent || 0);
        const time = trkpt.getElementsByTagName("time")[0]?.textContent || "";

        points.push({
          lat,
          lon,
          ele,
          time,
          index: i
        });
      }

      trackpoints.value = points;
      gpxData.value = xmlDoc;

      // Initialize map after parsing, but wait for DOM update
      nextTick(() => {
        initMap();
      });
    };

    // Initialize Leaflet map
    const initMap = () => {
      // Check if map container exists in DOM
      if (!mapRef.value) {
        console.error('Map container element not found');
        return;
      }

      // Create map if it doesn't exist
      if (!map) {
        // Mount St. Helena coordinates in Sonoma County, California
        const mtStHelenaCoords = [38.6695, -122.6291];

        // Use Mount St. Helena coordinates if no trackpoints, otherwise use first trackpoint
        const initialCoords = trackpoints.value.length 
          ? [trackpoints.value[0].lat, trackpoints.value[0].lon]
          : mtStHelenaCoords;

        map = L.map(mapRef.value).setView(initialCoords, 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        // Initialize draw control by default
        const drawOptions = {
          draw: {
            polyline: false,
            polygon: false,
            circle: false,
            marker: false,
            circlemarker: false,
            rectangle: {
              shapeOptions: {
                color: '#3388ff',
                weight: 2,
                opacity: 0.5,
                fill: true,
                fillColor: '#3388ff',
                fillOpacity: 0.2
              }
            }
          },
          edit: false
        };

        drawControl = new L.Control.Draw(drawOptions);
        map.addControl(drawControl);

        // Add event listener for when a rectangle is created
        map.on(L.Draw.Event.CREATED, handleAreaSelection);
      }

      // Ensure map is properly initialized
      if (!map) {
        console.error('Failed to initialize map');
        return;
      }

      // Create track polyline with visual indication of paused sections
      updateTrackLine();

      // Fit map to track bounds if track layer exists
      if (trackLayer) {
        map.fitBounds(trackLayer.getBounds());
      }

      // Add markers for each point
      markers.forEach(marker => map.removeLayer(marker));
      markers = [];

      trackpoints.value.forEach((point, index) => {
        const marker = L.circleMarker([point.lat, point.lon], {
          radius: 5,
          fillColor: pausedPoints.value.includes(index) ? 'red' : 'blue',
          color: selectedPoints.value.includes(index) ? 'yellow' : 'white',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.8
        }).addTo(map);

        marker.on('click', () => {
          togglePointSelection(index);
        });

        markers.push(marker);
      });
    };

    // Handle file upload
    const handleFileUpload = (event) => {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        parseGpx(e.target.result);
      };
      reader.readAsText(file);
    };


    // Toggle point selection
    const togglePointSelection = (index) => {
      const idx = selectedPoints.value.indexOf(index);
      if (idx === -1) {
        selectedPoints.value.push(index);
      } else {
        selectedPoints.value.splice(idx, 1);
      }

      // Update marker styles
      if (markers[index]) {
        const isSelected = selectedPoints.value.includes(index);
        const isPaused = pausedPoints.value.includes(index);

        markers[index].setStyle({
          fillColor: isPaused ? 'red' : 'blue',
          color: isSelected ? 'yellow' : 'white'
        });
      }
    };


    // Get raw XML for a track point
    const getRawTrackPointXml = (index) => {
      if (!gpxData.value || index === null || index < 0 || index >= trackpoints.value.length) {
        return '';
      }

      const trkpts = gpxData.value.getElementsByTagName("trkpt");
      if (index < trkpts.length) {
        const trkpt = trkpts[index];
        // Convert the XML node to a string with proper formatting
        const serializer = new XMLSerializer();
        const xmlString = serializer.serializeToString(trkpt);

        // Add basic formatting for readability
        return xmlString
          .replace(/></g, '>\n<')
          .replace(/<trkpt/g, '\n<trkpt')
          .replace(/<\/trkpt>/g, '\n</trkpt>');
      }

      return '';
    };

    // Clear selection
    const clearSelection = () => {
      selectedPoints.value = [];

      // Reset marker styles
      markers.forEach((marker, index) => {
        const isPaused = pausedPoints.value.includes(index);
        marker.setStyle({
          fillColor: isPaused ? 'red' : 'blue',
          color: 'white'
        });
      });

      // Remove any existing rectangle selection
      if (rectangleLayer) {
        map.removeLayer(rectangleLayer);
        rectangleLayer = null;
      }

      // If area selection mode is active, exit it
      if (isAreaSelectionMode.value) {
        toggleAreaSelectionMode();
      }
    };

    // Reset area selection (remove any existing rectangle)
    const toggleAreaSelectionMode = () => {
      // Remove any existing rectangle
      if (rectangleLayer) {
        map.removeLayer(rectangleLayer);
        rectangleLayer = null;
      }
    };

    // Handle area selection
    const handleAreaSelection = (event) => {
      // Remove any existing rectangle
      if (rectangleLayer) {
        map.removeLayer(rectangleLayer);
      }

      // Get the new rectangle layer
      rectangleLayer = event.layer;
      map.addLayer(rectangleLayer);

      // Get the bounds of the rectangle
      const bounds = rectangleLayer.getBounds();

      // Select all points within the rectangle
      trackpoints.value.forEach((point, index) => {
        const latLng = L.latLng(point.lat, point.lon);

        if (bounds.contains(latLng)) {
          // Add to selection if not already selected
          if (!selectedPoints.value.includes(index)) {
            selectedPoints.value.push(index);

            // Update marker style
            if (markers[index]) {
              const isPaused = pausedPoints.value.includes(index);
              markers[index].setStyle({
                fillColor: isPaused ? 'red' : 'blue',
                color: 'yellow'
              });
            }
          }
        }
      });
    };

    // Mark selected points as paused - immediately removing them from the data
    const markAsPaused = () => {
      if (selectedPoints.value.length === 0) {
        alert('Please select points first');
        return;
      }

      if (!gpxData.value) {
        console.error("No GPX data to update");
        return;
      }

      try {
        console.log(`Removing ${selectedPoints.value.length} paused points from GPX data`);

        // Sort selected points in descending order to avoid index shifting during removal
        const sortedPointsToRemove = [...selectedPoints.value].sort((a, b) => b - a);

        // Get all trackpoint elements
        const trkpt = gpxData.value.getElementsByTagName("trkpt");
        console.log(`Total points before removal: ${trkpt.length}`);

        // Track the removal time ranges for time adjustment
        let removalRanges = [];
        let lastRemovalStartTime = null;
        let lastRemovalEndTime = null;

        // Process points in reverse order to prevent index shifting issues
        for (const pointIndex of sortedPointsToRemove) {
          if (pointIndex >= trkpt.length) {
            console.warn(`Skipping invalid point index: ${pointIndex}`);
            continue;
          }

          const point = trkpt[pointIndex];
          const parentNode = point.parentNode;

          // Get the time before removing the point (for time adjustments)
          const timeElement = point.getElementsByTagName("time")[0];
          let pointTime = null;

          if (timeElement) {
            pointTime = new Date(timeElement.textContent);

            // If this is the start of a new removal range
            if (lastRemovalStartTime === null) {
              lastRemovalStartTime = pointTime;
              lastRemovalEndTime = pointTime;
            } else {
              // Check if this point is contiguous with the current range
              const timeDiff = Math.abs(pointTime - lastRemovalEndTime);

              if (timeDiff < 60000) { // Within 1 minute, part of same range
                if (pointTime < lastRemovalStartTime) {
                  lastRemovalStartTime = pointTime;
                } else if (pointTime > lastRemovalEndTime) {
                  lastRemovalEndTime = pointTime;
                }
              } else {
                // This is a new range, store the previous one
                removalRanges.push({
                  start: lastRemovalStartTime,
                  end: lastRemovalEndTime,
                  duration: lastRemovalEndTime - lastRemovalStartTime
                });

                // Start a new range
                lastRemovalStartTime = pointTime;
                lastRemovalEndTime = pointTime;
              }
            }
          }

          // Actually remove the point from the XML
          if (parentNode) {
            parentNode.removeChild(point);
          }
        }

        // Add the last removal range if it exists
        if (lastRemovalStartTime !== null) {
          removalRanges.push({
            start: lastRemovalStartTime,
            end: lastRemovalEndTime,
            duration: lastRemovalEndTime - lastRemovalStartTime
          });
        }

        console.log(`Created ${removalRanges.length} removal time ranges`);


        console.log(`Total points after removal: ${gpxData.value.getElementsByTagName("trkpt").length}`);

        // Clear selection
        selectedPoints.value = [];

        // Clear paused points array - we don't need to track them anymore since they're removed
        pausedPoints.value = [];

        // Remove any existing rectangle selection
        if (rectangleLayer) {
          map.removeLayer(rectangleLayer);
          rectangleLayer = null;
        }

        // Reset the map with the updated track data
        resetAndRedrawMap();

      } catch (error) {
        console.error("Error removing paused points:", error);
      }
    };


    // Reorganize GPX data into segments based on paused points
    const reorganizeGpxSegments = (pausedIndices) => {
      try {
        console.log("Reorganizing GPX segments based on paused points...");

        // Clone the GPX document to work with
        const serializer = new XMLSerializer();
        const parser = new DOMParser();
        const gpxString = serializer.serializeToString(gpxData.value);
        const gpxDoc = parser.parseFromString(gpxString, "text/xml");

        // Find the track element
        const track = gpxDoc.getElementsByTagName("trk")[0];
        if (!track) {
          console.error("No track element found in GPX data");
          return;
        }

        // Get all existing track segments first
        const existingSegments = track.getElementsByTagName("trkseg");

        // Create a flat array of all trackpoints with their metadata
        const allPoints = [];
        let pointIndex = 0;

        // Collect all points from all segments
        for (let i = 0; i < existingSegments.length; i++) {
          const segment = existingSegments[i];
          const trkpts = segment.getElementsByTagName("trkpt");

          for (let j = 0; j < trkpts.length; j++) {
            allPoints.push({
              element: trkpts[j],
              index: pointIndex++,
              originalSegment: i
            });
          }
        }

        console.log(`Collected ${allPoints.length} trackpoints for reorganization`);

        // Remove all existing track segments
        while (existingSegments.length > 0) {
          track.removeChild(existingSegments[0]);
        }

        // Create new segments based on paused status
        let currentSegment = gpxDoc.createElement("trkseg");
        track.appendChild(currentSegment);

        let inPausedSection = false;

        // Process all track points
        for (let i = 0; i < allPoints.length; i++) {
          const point = allPoints[i];
          const isPaused = pausedIndices.includes(point.index);

          // If transitioning between paused/unpaused, create a new segment
          if (isPaused !== inPausedSection) {
            if (i > 0) {  // Don't create a new segment for the first point
              // Start a new segment
              currentSegment = gpxDoc.createElement("trkseg");
              track.appendChild(currentSegment);
            }
            inPausedSection = isPaused;
            console.log(`Transition at point ${i}, creating new segment, paused: ${isPaused}`);
          }

          // Clone the track point and add it to the current segment
          const trkptClone = point.element.cloneNode(true);
          currentSegment.appendChild(trkptClone);
        }

        // Update the in-memory GPX data
        gpxData.value = gpxDoc;

        const totalSegments = track.getElementsByTagName("trkseg").length;
        console.log(`GPX data reorganized into ${totalSegments} segments`);

        // Validate segments
        validateSegments(track);
      } catch (error) {
        console.error("Error reorganizing GPX segments:", error);
      }
    };

    // Validate that segments are created correctly
    const validateSegments = (track) => {
      const segments = track.getElementsByTagName("trkseg");

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const points = segment.getElementsByTagName("trkpt");
        console.log(`Segment ${i}: ${points.length} points, paused: ${i % 2 !== 0}`);

        if (points.length === 0) {
          console.warn(`Empty segment at index ${i}`);
        }

        // Log first and last point of each segment
        if (points.length > 0) {
          const firstPoint = points[0];
          const lastPoint = points[points.length - 1];

          console.log(`Segment ${i} first: [${firstPoint.getAttribute("lat")}, ${firstPoint.getAttribute("lon")}], ` +
                      `last: [${lastPoint.getAttribute("lat")}, ${lastPoint.getAttribute("lon")}]`);
        }
      }
    };

    // Reset and redraw map with updated GPX data
    const resetAndRedrawMap = () => {
      console.log("Resetting and redrawing map...");

      // Clear existing layers
      if (trackLayer) {
        map.removeLayer(trackLayer);
        trackLayer = null;
      }

      markers.forEach(marker => {
        if (marker) {
          try {
            map.removeLayer(marker);
          } catch (e) {
            console.warn("Error removing marker:", e);
          }
        }
      });
      markers = [];

      // Refresh trackpoints array from GPX
      refreshTrackpointsFromGpx();

      // Update the map display
      updateTrackLine();

      // Re-add markers
      addTrackpointMarkers();

      console.log("Map reset and redrawn with updated paused points");
    };

    // Refresh trackpoints array from GPX data
    const refreshTrackpointsFromGpx = () => {
      if (!gpxData.value) return;

      console.log("Refreshing trackpoints from GPX...");

      // Get all track points
      const trkpts = gpxData.value.getElementsByTagName("trkpt");
      console.log(`Found ${trkpts.length} track points`);

      const points = [];

      // Process all points
      for (let i = 0; i < trkpts.length; i++) {
        const trkpt = trkpts[i];
        const lat = parseFloat(trkpt.getAttribute("lat"));
        const lon = parseFloat(trkpt.getAttribute("lon"));
        const ele = parseFloat(trkpt.getElementsByTagName("ele")[0]?.textContent || 0);
        const time = trkpt.getElementsByTagName("time")[0]?.textContent || "";

        points.push({
          lat,
          lon,
          ele,
          time,
          index: i
        });
      }

      console.log(`Refreshed ${points.length} total trackpoints`);
      trackpoints.value = points;
    };

    // Add markers for all trackpoints
    const addTrackpointMarkers = () => {
      console.log("Adding markers for all trackpoints...");

      // Clear existing markers
      markers.forEach(marker => map.removeLayer(marker));
      markers = [];

      // Add new markers
      trackpoints.value.forEach((point, index) => {
        // Points in odd-indexed segments are paused
        const isPaused = point.segmentIndex !== undefined ? point.segmentIndex % 2 !== 0 : false;

        const marker = L.circleMarker([point.lat, point.lon], {
          radius: 5,
          fillColor: isPaused ? 'red' : 'blue',
          color: selectedPoints.value.includes(index) ? 'yellow' : 'white',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.8
        }).addTo(map);

        marker.on('click', () => {
          togglePointSelection(index);
        });

        markers.push(marker);
      });

      console.log(`Added ${markers.length} markers`);
    };

    // Update track line visual to show the track with paused points
    const updateTrackLine = () => {
      if (!map || !gpxData.value) return;

      console.log("Updating track line visualization...");

      // Remove existing track layer
      if (trackLayer) {
        map.removeLayer(trackLayer);
      }

      // Create a feature group to hold the track
      trackLayer = L.featureGroup();
      map.addLayer(trackLayer);

      // Get all track points
      const trkpts = gpxData.value.getElementsByTagName("trkpt");
      console.log(`Rendering track with ${trkpts.length} points`);

      // Create a simple polyline for the entire track
      const coordinates = [];
      for (let i = 0; i < trkpts.length; i++) {
        const trkpt = trkpts[i];
        const lat = parseFloat(trkpt.getAttribute("lat"));
        const lon = parseFloat(trkpt.getAttribute("lon"));
        coordinates.push([lat, lon]);
      }

      // Create the main track polyline
      const mainPolyline = L.polyline(coordinates, {
        color: 'blue',
        weight: 4
      });

      mainPolyline.addTo(map);
      trackLayer.addLayer(mainPolyline);

      console.log(`Added main track polyline with ${coordinates.length} points`);

      // Fit map to track bounds if valid
      try {
        if (trackLayer.getBounds && trackLayer.getBounds().isValid()) {
          map.fitBounds(trackLayer.getBounds());
        } else {
          console.warn("Track layer bounds not valid, can't fit map");
        }
      } catch (e) {
        console.error("Error fitting map to bounds:", e);
      }
    };

    // Export GPX file
    const exportGpx = async () => {
      if (!gpxData.value) {
        console.error("No GPX data to export");
        return;
      }

      try {
        // Clone the in-memory GPX document
        const serializer = new XMLSerializer();
        const parser = new DOMParser();
        const gpxString = serializer.serializeToString(gpxData.value);
        const exportDoc = parser.parseFromString(gpxString, "text/xml");

        // Update the track name if needed
        const tracks = exportDoc.getElementsByTagName("trk");
        if (tracks.length > 0) {
          let trackNameElement = tracks[0].getElementsByTagName("name")[0];

          // Create track name element if it doesn't exist
          if (!trackNameElement) {
            trackNameElement = exportDoc.createElement("name");
            tracks[0].insertBefore(trackNameElement, tracks[0].firstChild);
          }

          trackNameElement.textContent = "Edited Track";
        }

        // Update metadata timestamp
        const metadataTimeElement = exportDoc.querySelector("metadata > time");
        if (metadataTimeElement) {
          metadataTimeElement.textContent = new Date().toISOString();
        }

        // Get the final GPX content
        const gpxContent = serializer.serializeToString(exportDoc);
        const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });

        console.log(`Export GPX content length: ${gpxContent.length}`);
        console.log(`Exporting ${exportDoc.getElementsByTagName("trkpt").length} points`);

        // Check if the File System Access API is supported
        if ('showSaveFilePicker' in window) {
          try {
            // Show the file picker
            const fileHandle = await window.showSaveFilePicker({
              suggestedName: 'edited_track.gpx',
              types: [{
                description: 'GPX Files',
                accept: {'application/gpx+xml': ['.gpx']}
              }]
            });

            // Get a writable stream
            const writable = await fileHandle.createWritable();

            // Write the GPX content to the file
            await writable.write(blob);

            // Close the file
            await writable.close();

            console.log("GPX export completed using File System Access API");
          } catch (err) {
            if (err.name !== 'AbortError') {
              console.error("Error using File System Access API:", err);
              // Fall back to the traditional download method
              downloadFile(blob, 'edited_track.gpx');
            } else {
              console.log("File save was cancelled by user");
            }
          }
        } else {
          // Fall back to the traditional download method for browsers without File System Access API
          console.log("File System Access API not supported, using fallback method");
          downloadFile(blob, 'edited_track.gpx');
        }
      } catch (error) {
        console.error("Error exporting GPX:", error);
      }
    };

    // Traditional download method as fallback
    const downloadFile = (blob, fileName) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log("GPX export completed using fallback download method");
    };

    // Format time for display
    const formatTime = (timeString) => {
      if (!timeString) return '';
      const date = new Date(timeString);
      return date.toLocaleTimeString();
    };

    // Check if point is the start of a paused section
    const isSegmentStart = (index) => {
      // A point is a pause start if it's paused and the previous point is not paused
      return pausedPoints.value.includes(index) && !pausedPoints.value.includes(index - 1);
    };

    // Check if point is the end of a paused section
    const isSegmentEnd = (index) => {
      // A point is a pause end if it's paused and the next point is not paused
      return pausedPoints.value.includes(index) && !pausedPoints.value.includes(index + 1);
    };

    // Render elevation graph
    const renderElevationGraph = () => {
      if (!graphContainerRef.value) return;

      // If no trackpoints, clear the graph and show a message
      if (!trackpoints.value.length) {
        if (graphContainerRef.value) {
          graphContainerRef.value.innerHTML = '<div class="no-data-message">No elevation data available. Upload a GPX file to view elevation profile.</div>';
        }
        return;
      }

      // Clear previous graph
      if (graphContainerRef.value) {
        graphContainerRef.value.innerHTML = '';
      }

      const container = graphContainerRef.value;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      // Margins for axes
      const margin = {
        top: 20,
        right: 30,
        bottom: 40,
        left: 60
      };

      // Adjusted dimensions for the chart area
      const chartWidth = containerWidth - margin.left - margin.right;
      const chartHeight = containerHeight - margin.top - margin.bottom;

      // Find min and max elevation
      let minEle = Infinity;
      let maxEle = -Infinity;

      // Find min and max time
      let minTime = new Date(trackpoints.value[0].time);
      let maxTime = new Date(trackpoints.value[0].time);

      trackpoints.value.forEach(point => {
        if (point.ele < minEle) minEle = point.ele;
        if (point.ele > maxEle) maxEle = point.ele;

        const pointTime = new Date(point.time);
        if (pointTime < minTime) minTime = pointTime;
        if (pointTime > maxTime) maxTime = pointTime;
      });

      // Add some padding to min/max elevation
      const padding = (maxEle - minEle) * 0.1;
      minEle = Math.max(0, minEle - padding);
      maxEle = maxEle + padding;

      // Time range in milliseconds
      const timeRange = maxTime - minTime;

      // Create SVG element
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', containerWidth);
      svg.setAttribute('height', containerHeight);
      svg.style.display = 'block';

      // Create a group for the chart area with margins
      const chartGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      chartGroup.setAttribute('transform', `translate(${margin.left},${margin.top})`);
      svg.appendChild(chartGroup);

      // Calculate scales
      const xScale = chartWidth / timeRange; // Scale for time
      const yScale = chartHeight / (maxEle - minEle);

      // Create grid lines
      // Horizontal grid lines (elevation)
      const elevationStep = Math.ceil((maxEle - minEle) / 5); // 5 grid lines
      for (let ele = Math.ceil(minEle); ele <= maxEle; ele += elevationStep) {
        const y = chartHeight - (ele - minEle) * yScale;

        // Grid line
        const gridLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        gridLine.setAttribute('x1', 0);
        gridLine.setAttribute('y1', y);
        gridLine.setAttribute('x2', chartWidth);
        gridLine.setAttribute('y2', y);
        gridLine.setAttribute('stroke', '#e0e0e0');
        gridLine.setAttribute('stroke-width', '1');
        gridLine.setAttribute('stroke-dasharray', '3,3');
        chartGroup.appendChild(gridLine);

        // Y-axis label
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', -5);
        label.setAttribute('y', y);
        label.setAttribute('text-anchor', 'end');
        label.setAttribute('dominant-baseline', 'middle');
        label.setAttribute('font-size', '12px');
        label.setAttribute('fill', '#666');
        label.textContent = `${Math.round(ele)}m`;
        chartGroup.appendChild(label);
      }

      // Vertical grid lines (time)
      const timeStep = Math.ceil(timeRange / 5); // 5 grid lines
      for (let t = 0; t <= timeRange; t += timeStep) {
        const x = t * xScale;

        // Grid line
        const gridLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        gridLine.setAttribute('x1', x);
        gridLine.setAttribute('y1', 0);
        gridLine.setAttribute('x2', x);
        gridLine.setAttribute('y2', chartHeight);
        gridLine.setAttribute('stroke', '#e0e0e0');
        gridLine.setAttribute('stroke-width', '1');
        gridLine.setAttribute('stroke-dasharray', '3,3');
        chartGroup.appendChild(gridLine);

        // X-axis label
        const time = new Date(minTime.getTime() + t);
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', x);
        label.setAttribute('y', chartHeight + 20);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('font-size', '12px');
        label.setAttribute('fill', '#666');
        label.textContent = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        chartGroup.appendChild(label);
      }

      // Y-axis title
      const yAxisTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      yAxisTitle.setAttribute('transform', `translate(${-margin.left + 15},${chartHeight/2}) rotate(-90)`);
      yAxisTitle.setAttribute('text-anchor', 'middle');
      yAxisTitle.setAttribute('font-size', '14px');
      yAxisTitle.setAttribute('font-weight', 'bold');
      yAxisTitle.setAttribute('fill', '#333');
      yAxisTitle.textContent = 'Elevation (m)';
      chartGroup.appendChild(yAxisTitle);

      // X-axis title
      const xAxisTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      xAxisTitle.setAttribute('x', chartWidth / 2);
      xAxisTitle.setAttribute('y', chartHeight + margin.bottom - 5);
      xAxisTitle.setAttribute('text-anchor', 'middle');
      xAxisTitle.setAttribute('font-size', '14px');
      xAxisTitle.setAttribute('font-weight', 'bold');
      xAxisTitle.setAttribute('fill', '#333');
      xAxisTitle.textContent = 'Time';
      chartGroup.appendChild(xAxisTitle);

      // Create path
      let pathData = '';

      trackpoints.value.forEach((point, i) => {
        const pointTime = new Date(point.time);
        const x = (pointTime - minTime) * xScale;
        const y = chartHeight - (point.ele - minEle) * yScale;

        if (i === 0) {
          pathData = `M ${x},${y}`;
        } else {
          pathData += ` L ${x},${y}`;
        }
      });

      // Add path to SVG
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#1890ff');
      path.setAttribute('stroke-width', '2');
      chartGroup.appendChild(path);

      // Add area under the path
      const areaPathData = pathData + ` L ${chartWidth},${chartHeight} L 0,${chartHeight} Z`;
      const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      areaPath.setAttribute('d', areaPathData);
      areaPath.setAttribute('fill', 'rgba(24, 144, 255, 0.1)');
      areaPath.setAttribute('stroke', 'none');
      chartGroup.insertBefore(areaPath, path);

      // Add the SVG to the container
      container.appendChild(svg);

      // Store reference to the chart
      elevationChart = {
        svg,
        containerWidth,
        containerHeight,
        chartWidth,
        chartHeight,
        margin,
        minTime,
        timeRange,
        xScale,
        minEle,
        maxEle
      };
    };

    // Handle hover on elevation graph
    const handleElevationGraphHover = (event) => {
      if (!elevationChart || !trackpoints.value.length) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left - elevationChart.margin.left;

      if (x < 0 || x > elevationChart.chartWidth) return;

      // Calculate the time at the hover position
      const hoverTime = elevationChart.minTime.getTime() + (x / elevationChart.xScale);

      // Find the closest point to the hover time
      let closestPointIndex = 0;
      let minTimeDiff = Infinity;

      trackpoints.value.forEach((point, index) => {
        const pointTime = new Date(point.time).getTime();
        const timeDiff = Math.abs(pointTime - hoverTime);

        if (timeDiff < minTimeDiff) {
          minTimeDiff = timeDiff;
          closestPointIndex = index;
        }
      });

      // Update hovered point index
      hoveredPointIndex.value = closestPointIndex;

      // Highlight the point on the map
      highlightPointOnMap(closestPointIndex);

      // Scroll to the point in the track list
      scrollToTrackPoint(closestPointIndex);
    };

    // Handle mouse leave from elevation graph
    const handleElevationGraphLeave = () => {
      hoveredPointIndex.value = null;

      // Reset marker styles
      markers.forEach((marker, index) => {
        const isSelected = selectedPoints.value.includes(index);
        marker.setStyle({
          fillColor: 'blue',
          color: isSelected ? 'yellow' : 'white',
          radius: 5
        });
      });
    };

    // Highlight point on map
    const highlightPointOnMap = (index) => {
      if (!markers[index]) return;

      // Reset all markers first
      markers.forEach((marker, i) => {
        const isSelected = selectedPoints.value.includes(i);
        marker.setStyle({
          fillColor: 'blue',
          color: isSelected ? 'yellow' : 'white',
          radius: i === index ? 8 : 5
        });
      });

      // Highlight the hovered marker
      markers[index].setStyle({
        fillColor: 'red',
        color: 'yellow',
        radius: 8
      });

      // Do not pan the map to the point
    };

    // Scroll to track point in the list
    const scrollToTrackPoint = (index) => {
      if (!trackPointRefs.value[index]) return;

      const container = document.querySelector('.track-points-container');
      if (!container) return;

      const element = trackPointRefs.value[index];

      // Scroll to the element and center it in the container
      container.scrollTop = element.offsetTop - container.offsetTop - (container.clientHeight / 2) + (element.clientHeight / 2);

      // Ensure the point is highlighted in the track points panel
      hoveredPointIndex.value = index;
    };

    // Watch for changes in trackpoints to update the elevation graph
    watch(trackpoints, () => {
      nextTick(() => {
        renderElevationGraph();
      });
    });

    onMounted(() => {
      // Wait for DOM to be fully rendered
      nextTick(() => {
        // Initialize map regardless of whether trackpoints exist
        initMap();

        // Only render elevation graph if trackpoints exist
        if (trackpoints.value.length) {
          renderElevationGraph();
        }
      });
    });

    return {
      gpxData,
      trackpoints,
      selectedPoints,
      pausedPoints,
      mapRef,
      isAreaSelectionMode,
      hoveredPointIndex,
      elevationGraphRef,
      graphContainerRef,
      trackPointRefs,
      debugPointIndex,
      handleFileUpload,
      togglePointSelection,
      clearSelection,
      markAsPaused,
      exportGpx,
      formatTime,
      toggleAreaSelectionMode,
      isSegmentStart,
      isSegmentEnd,
      handleElevationGraphHover,
      handleElevationGraphLeave,
      getRawTrackPointXml
    };
  }
};
</script>

<style>
.app-container {
  font-family: Arial, sans-serif;
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

h1 {
  text-align: center;
  color: #333;
}

.editor-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-top: 20px;
}

.file-upload {
  text-align: center;
  padding: 40px;
  border: 2px dashed #ccc;
  border-radius: 8px;
}

.gpx-editor {
  display: grid;
  grid-template-columns: 1fr 300px 300px;
  grid-template-rows: 500px 200px auto;
  gap: 20px;
  height: auto;
  min-height: 80vh;
}

.map-container {
  grid-column: 1;
  grid-row: 1;
  border: 1px solid #ccc;
  border-radius: 8px;
  overflow: hidden;
  height: 100%;
}

#map {
  height: 100%;
  width: 100%;
}

.track-list {
  grid-column: 2;
  grid-row: 1;
  padding: 15px;
  border: 1px solid #ccc;
  border-radius: 8px;
  background-color: #f9f9f9;
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.controls-panel {
  grid-column: 3;
  grid-row: 1;
  height: 100%;
  overflow: hidden;
}

.controls {
  padding: 15px;
  border: 1px solid #ccc;
  border-radius: 8px;
  background-color: #f9f9f9;
  height: 100%;
  overflow-y: auto;
}

.track-points-container {
  height: calc(100% - 40px);
  overflow-y: auto;
}

.elevation-graph {
  grid-column: 1 / span 3;
  grid-row: 2;
  border: 1px solid #ccc;
  border-radius: 8px;
  background-color: #f9f9f9;
  padding: 15px;
  display: flex;
  flex-direction: column;
}

.graph-container {
  flex: 1;
  position: relative;
  cursor: crosshair;
}

.track-point {
  padding: 8px;
  margin: 4px 0;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: #f0f0f0;
  transition: all 0.3s ease;
  flex-wrap: wrap;
  gap: 8px;
}

.track-point:hover {
  background-color: #e0e0e0;
  transform: translateY(-1px);
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.track-point.selected {
  background-color: #e6f7ff;
  border: 1px solid #1890ff;
}

.track-point.highlighted {
  background-color: #fffbe6;
  border: 1px solid #faad14;
  box-shadow: 0 0 5px rgba(250, 173, 20, 0.5);
}

.point-index {
  font-weight: bold;
  min-width: 30px;
  flex: 0 0 auto;
}

.point-time {
  font-family: monospace;
  flex: 0 0 auto;
  min-width: 80px;
}

.point-coords, .point-elevation {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 0.85em;
  color: #555;
}

.metadata-row {
  display: flex;
  flex-wrap: wrap;
  margin: 2px 0;
}

.metadata-label {
  font-weight: bold;
  margin-right: 4px;
  min-width: 40px;
}

.metadata-value {
  margin-right: 12px;
  font-family: monospace;
}

.elevation-change {
  font-weight: bold;
}

.elevation-change.positive {
  color: #52c41a;
}

.elevation-change.negative {
  color: #f5222d;
}

.point-status {
  display: flex;
  justify-content: flex-end;
  margin-left: auto;
  flex: 0 0 auto;
}

.paused-indicator {
  color: #ff4d4f;
  font-weight: bold;
  background-color: rgba(255, 77, 79, 0.1);
  padding: 2px 6px;
  border-radius: 2px;
  font-size: 0.8em;
}

.segment-indicator {
  color: #1890ff;
  font-weight: bold;
  background-color: rgba(24, 144, 255, 0.1);
  padding: 2px 6px;
  border-radius: 2px;
  font-size: 0.8em;
}

button {
  padding: 8px 16px;
  margin: 5px;
  border: none;
  border-radius: 4px;
  background-color: #1890ff;
  color: white;
  cursor: pointer;
}

button:hover {
  background-color: #40a9ff;
}

button:disabled {
  background-color: #d9d9d9;
  cursor: not-allowed;
}

.selection-controls, .export-controls, .track-info {
  margin-bottom: 15px;
}

h3 {
  margin-top: 0;
  margin-bottom: 10px;
  color: #333;
}

.area-selection-btn {
  display: block;
  width: 100%;
  margin-top: 10px;
}

.area-selection-btn.active {
  background-color: #ff9800;
}

.area-selection-btn.active:hover {
  background-color: #f57c00;
}

.area-selection-help {
  margin-top: 10px;
  padding: 8px;
  background-color: #fff3e0;
  border-left: 3px solid #ff9800;
  font-size: 0.9em;
}

.pause-info {
  margin-top: 15px;
  padding: 10px;
  background-color: #e8f4fd;
  border-left: 3px solid #1890ff;
  border-radius: 4px;
  font-size: 0.9em;
}

.pause-info p {
  margin: 5px 0;
}

.pause-info strong {
  color: #1890ff;
}

.file-upload-controls {
  margin-top: 15px;
  padding: 10px;
  background-color: #f0f7ff;
  border-radius: 4px;
  border-left: 3px solid #1890ff;
}

.file-upload-controls h4 {
  margin-top: 0;
  margin-bottom: 10px;
  color: #1890ff;
}

.file-upload-controls input[type="file"] {
  margin-bottom: 10px;
  width: 100%;
}

.no-data-message {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  color: #999;
  font-style: italic;
  text-align: center;
  padding: 20px;
}
/* Debug Modal Styles */
.debug-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.debug-modal-content {
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  width: 80%;
  max-width: 800px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.debug-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  background-color: #f0f7ff;
  border-bottom: 1px solid #e0e0e0;
}

.debug-modal-header h3 {
  margin: 0;
  color: #1890ff;
}

.close-button {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #666;
  padding: 0;
  margin: 0;
  width: 30px;
  height: 30px;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 50%;
}

.close-button:hover {
  background-color: #f0f0f0;
  color: #333;
}

.debug-modal-body {
  padding: 20px;
  overflow-y: auto;
  max-height: calc(80vh - 70px);
}

.debug-point-info {
  margin-bottom: 15px;
  font-weight: bold;
  color: #333;
  padding: 8px 12px;
  background-color: #f5f5f5;
  border-radius: 4px;
  display: inline-block;
}

.debug-xml {
  background-color: #282c34;
  color: #abb2bf;
  padding: 15px;
  border-radius: 6px;
  overflow-x: auto;
  font-family: 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}

/* XML Syntax Highlighting */
.debug-xml .tag {
  color: #e06c75;
}

.debug-xml .attr-name {
  color: #d19a66;
}

.debug-xml .attr-value {
  color: #98c379;
}

/* Debug Panel Styles */
.debug-panel {
  grid-column: 1 / span 3;
  grid-row: 3;
  border: 1px solid #ccc;
  border-radius: 8px;
  background-color: #f9f9f9;
  padding: 15px;
  display: flex;
  flex-direction: column;
  height: 300px;
  overflow: hidden;
}

.debug-panel-content {
  flex: 1;
  overflow-y: auto;
}

.selected-points-debug {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.debug-point {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  overflow: hidden;
}

.debug-point-header {
  background-color: #f0f7ff;
  padding: 10px;
  border-bottom: 1px solid #e0e0e0;
}

.debug-point-header h4 {
  margin: 0;
  color: #1890ff;
}
</style>
