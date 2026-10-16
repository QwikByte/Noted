'use client'
// Gemeinsame Einstellungen für Flächen auf Basis von React Flow (Mindmap und Canvas)
import '@xyflow/react/dist/style.css'
import type { AriaLabelConfig } from '@xyflow/react'

/** Bildschirmleser-Texte auf Deutsch */
export const FLOW_ARIA_LABELS: Partial<AriaLabelConfig> = {
  'node.a11yDescription.default': 'Mit Enter oder Leertaste auswählen, mit Entf löschen, mit Escape abbrechen.',
  'node.a11yDescription.keyboardDisabled':
    'Mit Enter oder Leertaste auswählen und dann mit den Pfeiltasten verschieben. Mit Entf löschen, mit Escape abbrechen.',
  'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) => `Verschoben nach ${direction}. Neue Position: x ${x}, y ${y}`,
  'edge.a11yDescription.default': 'Mit Enter oder Leertaste auswählen, mit Entf löschen, mit Escape abbrechen.',
  'controls.ariaLabel': 'Ansicht',
  'controls.zoomIn.ariaLabel': 'Vergrößern',
  'controls.zoomOut.ariaLabel': 'Verkleinern',
  'controls.fitView.ariaLabel': 'Alles anzeigen',
  'controls.interactive.ariaLabel': 'Bearbeiten ein/aus',
  'minimap.ariaLabel': 'Übersicht',
  'handle.ariaLabel': 'Anschluss für Pfeile',
}

/** Kein Hinweis auf React Flow in der Ecke – die Bibliothek steht unter MIT-Lizenz, das ist erlaubt */
export const FLOW_PRO_OPTIONS = { hideAttribution: true }
