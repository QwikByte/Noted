import { describe, expect, it } from 'vitest'
import { admission, admissionHint, formatPoints } from './admission'

const sheet = (maxPoints: number, points: number | null = null) => ({ maxPoints, points })

describe('Klausurzulassung', () => {
  it('rechnet mit den angelegten Blättern, wenn die Zahl im Semester offen ist', () => {
    const a = admission({ requiredPercent: 50, plannedSheets: null }, [sheet(20, 12), sheet(20, 8.5), sheet(20), sheet(20)])
    expect(a).toEqual({
      total: 80,
      estimated: false,
      required: 40,
      achieved: 20.5,
      missing: 19.5,
      openSheets: 2,
      openPoints: 40,
      state: 'open',
    })
    expect(admissionHint(a)).toBe('Noch 19,5 Punkte aus 2 Blättern nötig – im Schnitt 10 pro Blatt.')
  })

  it('schätzt fehlende Blätter mit dem Durchschnitt der vorhandenen', () => {
    const a = admission({ requiredPercent: 50, plannedSheets: 12 }, [sheet(20, 18), sheet(30, 21)])
    expect(a).toMatchObject({ total: 300, estimated: true, required: 150, achieved: 39, missing: 111, openSheets: 10, openPoints: 250 })
    expect(admissionHint(a)).toBe('Noch 111 Punkte aus 10 Blättern nötig – im Schnitt 11,5 pro Blatt.')
  })

  it('erkennt erreichte und nicht mehr erreichbare Zulassungen – Zusatzpunkte zählen mit', () => {
    const reached = admission({ requiredPercent: 50, plannedSheets: 3 }, [sheet(10, 12), sheet(10, 4), sheet(10)])
    expect(reached.state).toBe('reached')
    expect(admissionHint(reached)).toBe('Zulassung erreicht: 16 von 15 nötigen Punkten.')

    const lost = admission({ requiredPercent: 60, plannedSheets: null }, [sheet(10, 2), sheet(10, 1), sheet(10)])
    expect(lost).toMatchObject({ state: 'unreachable', missing: 15, openPoints: 10 })
    expect(admissionHint(lost)).toBe('Nicht mehr erreichbar: Es fehlen 15 Punkte, offen sind nur noch 10 Punkte.')

    const done = admission({ requiredPercent: 50, plannedSheets: null }, [sheet(10, 4)])
    expect(admissionHint(done)).toBe('Nicht erreicht: Es fehlt 1 Punkt, alle Blätter sind korrigiert.')

    expect(admissionHint(admission({ requiredPercent: 50, plannedSheets: null }, [sheet(10, 3), sheet(10)]))).toBe(
      'Noch 7 Punkte aus 1 Blatt nötig.',
    )
  })

  it('ohne Blätter gibt es nichts zu rechnen', () => {
    const a = admission({ requiredPercent: 50, plannedSheets: 12 }, [])
    expect(a).toMatchObject({ state: 'empty', total: 0, openSheets: 12 })
    expect(admissionHint(a)).toBe('Noch keine Übungsblätter.')
    expect(formatPoints(7.25)).toBe('7,25')
  })
})
