import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import { createTestKernel, type TestKernel } from '../helpers/createTestKernel'

describe('Declarative Modal Plugin E2E Test', () => {
  let k: TestKernel

  const pluginsDir = path.join(__dirname, '../../../../../plugins')
  const scextPath = path.join(pluginsDir, 'declarative-modal-test.scext')

  beforeEach(() => {
    k = createTestKernel({ tmpPrefix: 'declarative-modal-test-' })
  })

  afterEach(async () => {
    await k.teardown()
  })

  it('installs .scext plugin, auto-registers chatActions, and executes Tier 1 form, confirm, alert modal flows', async () => {
    // 1. Install .scext archive
    const manifest = await k.loader.install(scextPath)
    expect(manifest.id).toBe('com.smartchat.declarative-modal-test')

    k.permissions.registerPluginManifest(manifest.id, ['ui:notification', 'ui:modal', 'ui:toast'])
    await k.host.load(manifest.id)

    expect(k.host.listLoaded()).toContain(manifest.id)

    // 2. Check registered contributions
    const chatActions = k.contributions.getAll('chat-action')
    expect(chatActions.length).toBeGreaterThanOrEqual(3)

    const formAction = chatActions.find((a) => a.id === 'test-form-action')
    const confirmAction = chatActions.find((a) => a.id === 'test-confirm-action')
    const alertAction = chatActions.find((a) => a.id === 'test-alert-action')

    expect(formAction).toBeDefined()
    expect(confirmAction).toBeDefined()
    expect(alertAction).toBeDefined()

    const uiModule = k.router.getModule('kernel:ui')!

    // 3. Test Form Modal Flow
    const showModalSpy = vi.spyOn(k.overlayHost, 'showModal')

    const formPromise = uiModule.handle(manifest.id, 'kernel:ui:showForm', {
      title: 'Configure Options',
      fields: [{ id: 'name', type: 'text', label: 'Name', defaultValue: 'John' }]
    })

    expect(showModalSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'form',
        payload: expect.objectContaining({ title: 'Configure Options' })
      })
    )

    const formReq = showModalSpy.mock.calls[0][0]
    k.overlayHost.resolveModal(formReq.modalId, { name: 'John' })

    const formResult = await formPromise
    expect(formResult).toEqual({ name: 'John' })

    // 4. Test Confirm Modal Flow
    const confirmPromise = uiModule.handle(manifest.id, 'kernel:ui:showConfirm', {
      title: 'Confirm Operation',
      body: 'Proceed?'
    })

    expect(showModalSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'confirm',
        payload: expect.objectContaining({ title: 'Confirm Operation' })
      })
    )

    const confirmReq = showModalSpy.mock.calls[1][0]
    k.overlayHost.resolveModal(confirmReq.modalId, true)

    const confirmResult = await confirmPromise
    expect(confirmResult).toBe(true)

    // 5. Test Alert Modal Flow
    const alertPromise = uiModule.handle(manifest.id, 'kernel:ui:showAlert', {
      title: 'System Alert',
      body: 'Important message'
    })

    expect(showModalSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'alert',
        payload: expect.objectContaining({ title: 'System Alert' })
      })
    )

    const alertReq = showModalSpy.mock.calls[2][0]
    k.overlayHost.resolveModal(alertReq.modalId, undefined)

    const alertResult = await alertPromise
    expect(alertResult).toBeUndefined()
  })
})
