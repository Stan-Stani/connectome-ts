export const ComponentList = {
  name: 'ComponentList',
  props: {
    components: { type: Array, required: true }
  },
  emits: ['select'],
  template: `
    <div v-if="components.length" class="component-list">
      <div
        v-for="(component, index) in components"
        :key="component.id || index"
        class="component-item"
        :class="{ disabled: !component.enabled }"
        @click="$emit('select', component)"
      >
        <span class="component-index">#{{ component.index || index }}</span>
        <span class="component-name">{{ component.name }}</span>
        <span class="component-priority" :title="'Priority: ' + component.priority">
          {{ component.priority }}
        </span>
        <span class="component-status" v-if="!component.enabled">⏸</span>
      </div>
    </div>
    <div v-else class="text-muted" style="padding: 12px;">No components registered.</div>
  `
};
