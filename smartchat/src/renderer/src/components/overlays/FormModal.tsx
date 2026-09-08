import React, { useState } from 'react'
import { X } from 'lucide-react'
import { OverlayFormSchema } from '@smartchat/sdk'

export interface FormModalProps {
  modalId: string
  schema: OverlayFormSchema
  onSubmit: (values: Record<string, unknown> | null) => void
}

export function FormModal({ schema, onSubmit }: FormModalProps) {
  const [formValues, setFormValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {}
    for (const field of schema.fields) {
      if (field.defaultValue !== undefined) {
        initial[field.id] = field.defaultValue
      } else if (field.type === 'checkbox') {
        initial[field.id] = false
      } else if (field.type === 'select' && field.options && field.options.length > 0) {
        initial[field.id] = field.options[0].value
      } else {
        initial[field.id] = ''
      }
    }
    return initial
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleChange = (id: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [id]: value }))
    if (errors[id]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const newErrors: Record<string, string> = {}
    for (const field of schema.fields) {
      if (field.required) {
        const val = formValues[field.id]
        // F10-04: a required checkbox must be ticked (`false` is not "filled"),
        // and a required radio must have an option chosen.
        const missing =
          field.type === 'checkbox'
            ? val !== true
            : field.type === 'radio'
              ? val === undefined || val === null || val === ''
              : val === undefined || val === null || val === ''
        if (missing) {
          newErrors[field.id] = `${field.label} is required`
        }
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    onSubmit(formValues)
  }

  const handleCancel = () => {
    onSubmit(null)
  }

  return (
    <div className="tier1-modal" data-testid="form-modal">
      <div className="tier1-modal-header">
        <h3 className="tier1-modal-title">{schema.title}</h3>
        <button
          type="button"
          className="close-btn"
          onClick={handleCancel}
          aria-label="Close"
          data-testid="form-modal-close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div className="tier1-modal-body">
          {schema.fields.map((field) => (
            <div key={field.id} className="tier1-field-group">
              {field.type !== 'checkbox' && (
                <label className="tier1-field-label" htmlFor={`field-${field.id}`}>
                  {field.label}
                  {field.required && <span style={{ color: 'var(--wa-danger)', marginLeft: '4px' }}>*</span>}
                </label>
              )}

              {field.type === 'text' && (
                <input
                  id={`field-${field.id}`}
                  type="text"
                  className="tier1-input"
                  placeholder={field.placeholder || ''}
                  value={String(formValues[field.id] ?? '')}
                  onChange={(e) => handleChange(field.id, e.target.value)}
                  data-testid={`field-input-${field.id}`}
                />
              )}

              {field.type === 'textarea' && (
                <textarea
                  id={`field-${field.id}`}
                  className="tier1-textarea"
                  placeholder={field.placeholder || ''}
                  value={String(formValues[field.id] ?? '')}
                  onChange={(e) => handleChange(field.id, e.target.value)}
                  data-testid={`field-textarea-${field.id}`}
                />
              )}

              {field.type === 'select' && (
                <select
                  id={`field-${field.id}`}
                  className="tier1-select"
                  value={String(formValues[field.id] ?? '')}
                  onChange={(e) => handleChange(field.id, e.target.value)}
                  data-testid={`field-select-${field.id}`}
                >
                  {field.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}

              {field.type === 'radio' && (
                <div className="tier1-radio-group">
                  {field.options?.map((opt) => (
                    <label key={opt.value} className="tier1-radio-item">
                      <input
                        type="radio"
                        name={`radio-${field.id}`}
                        value={opt.value}
                        checked={formValues[field.id] === opt.value}
                        onChange={() => handleChange(field.id, opt.value)}
                        data-testid={`field-radio-${field.id}-${opt.value}`}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              )}

              {field.type === 'checkbox' && (
                <label className="tier1-checkbox-item">
                  <input
                    type="checkbox"
                    checked={Boolean(formValues[field.id])}
                    onChange={(e) => handleChange(field.id, e.target.checked)}
                    data-testid={`field-checkbox-${field.id}`}
                  />
                  <span>
                    {field.label}
                    {field.required && <span style={{ color: 'var(--wa-danger)', marginLeft: '4px' }}>*</span>}
                  </span>
                </label>
              )}

              {errors[field.id] && (
                <span style={{ color: 'var(--wa-danger)', fontSize: '0.8rem' }}>
                  {errors[field.id]}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="tier1-modal-footer">
          <button
            type="button"
            className="tier1-btn tier1-btn-secondary"
            onClick={handleCancel}
            data-testid="form-modal-cancel"
          >
            {schema.cancelLabel || 'Cancel'}
          </button>
          <button type="submit" className="tier1-btn tier1-btn-primary" data-testid="form-modal-submit">
            {schema.submitLabel || 'Submit'}
          </button>
        </div>
      </form>
    </div>
  )
}
