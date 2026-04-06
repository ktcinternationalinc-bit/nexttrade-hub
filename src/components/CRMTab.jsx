'use client';
import { useState, useMemo } from 'react';
import { supabase, dbInsert, dbUpdate } from '../lib/supabase';
import { fmt, fE } from '../lib/utils';

export default function CRMTab({ customers, notes, followUps, invoices, user, onReload }) {
  const [selClient, setSelClient] = useState(null);
  const [searchQ, setSearchQ] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('alpha');
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);
  const [showAddFollowUp, setShowAddFollowUp] = useState(false);
  const [form, setForm] = useState({});

  const groups = [...new Set(customers.map(c => c.group_name).filter(Boolean))].sort();
  const types = [...new Set(customers.map(c => c.client_type).filter(Boolean))].sort();

  const clientNotes = (clientId) => notes.filter(n => n.customer_id === clientId);
  const clientFollowUps = (clientId) => followUps.filter(f => f.customer_id === clientId);
  const clientInvoices = (clientId) => invoices.filter(i => i.customer_id === clientId);

  const filtered = useMemo(() => {
    let arr = customers.filter(c => {
      if (searchQ && !c.name?.includes(searchQ) && !c.name_ar?.includes(searchQ)) return false;
      if (groupFilter !== 'all' && c.group_name !== groupFilter) return false;
      if (typeFilter !== 'all' && c.client_type !== typeFilter) return false;
      return true;
    });

    arr.sort((a, b) => {
      if (sortBy === 'alpha') return (a.name || '').localeCompare(b.name || '');
      if (sortBy === 'alpha_desc') return (b.name || '').localeCompare(a.name || '');
      if (sortBy === 'recent_note') {
        const aN = clientNotes(a.id)[0]?.created_at || '';
        const bN = clientNotes(b.id)[0]?.created_at || '';
        return bN.localeCompare(aN);
      }
      if (sortBy === 'most_orders') return clientInvoices(b.id).length - clientInvoices(a.id).length;
      return 0;
    });

    return arr;
  }, [customers, searchQ, groupFilter, typeFilter, sortBy]);

  const handleAddClient = async () => {
    if (!form.name) return;
    try {
      await dbInsert('customers', {
        name: form.name,
        name_ar: form.nameAr || form.name,
        phone: form.phone || '',
        email: form.email || '',
        client_type: form.clientType || '',
        industry: form.industry || '',
        lead_source: form.leadSource || '',
        credit_limit: form.creditLimit ? Number(form.creditLimit) : null,
        address: form.address || '',
        city: form.city || '',
        group_name: form.group || form.newGroup || '',
        status: 'active',
      }, user?.id);
      if (form.notes) {
        // Add initial note
        const { data: newCust } = await supabase.from('customers').select('id').eq('name', form.name).single();
        if (newCust) {
          await dbInsert('client_notes', { customer_id: newCust.id, note_text: form.notes }, user?.id);
        }
      }
      setShowAddClient(false);
      setForm({});
      onReload();
    } catch (err) { alert('Error: ' + err.message); }
  };

  const handleAddNote = async () => {
    if (!form.noteText || !selClient) return;
    try {
      await dbInsert('client_notes', { customer_id: selClient.id, note_text: form.noteText }, user?.id);
      setShowAddNote(false);
      setForm({});
      onReload();
    } catch (err) { alert('Error: ' + err.message); }
  };

  const handleAddFollowUp = async () => {
    if (!form.task || !form.dueDate || !selClient) return;
    try {
      await dbInsert('follow_ups', {
        customer_id: selClient.id,
        task: form.task,
        due_date: form.dueDate,
        due_time: form.dueTime || '09:00',
        assigned_to: form.assignTo || user?.id,
      }, user?.id);
      // Also create calendar event
      await dbInsert('calendar_events', {
        title: 'Follow-up: ' + form.task + ' (' + selClient.name + ')',
        event_date: form.dueDate,
        event_time: form.dueTime || '09:00',
        event_type: 'call',
        assigned_to: form.assignTo || user?.id,
        customer_id: selClient.id,
      }, user?.id);
      setShowAddFollowUp(false);
      setForm({});
      onReload();
    } catch (err) { alert('Error: ' + err.message); }
  };

  const completeFollowUp = async (followUpId) => {
    try {
      await dbUpdate('follow_ups', followUpId, { completed: true, completed_at: new Date().toISOString() }, user?.id);
      onReload();
    } catch (err) { alert('Error: ' + err.message); }
  };

  // ... render methods would go here
  // This is the data/logic layer - the JSX rendering follows the same
  // patterns as the prototype but with real database calls

  return { filtered, selClient, setSelClient, searchQ, setSearchQ, groupFilter, setGroupFilter, typeFilter, setTypeFilter, sortBy, setSortBy, showAddClient, setShowAddClient, form, setForm, handleAddClient, handleAddNote, handleAddFollowUp, completeFollowUp, clientNotes, clientFollowUps, clientInvoices, groups, types };
}
