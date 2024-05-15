import { useStoreGetters, useStore } from 'dashboard/composables/store';
import { BUS_EVENTS } from 'shared/constants/busEvents';
import { differenceInSeconds } from 'date-fns';

import {
  isAConversationRoute,
  isAInboxViewRoute,
  isNotificationRoute,
} from 'dashboard/helper/routeHelpers';

export default class ReconnectService {
  static instance;

  constructor(route, filters) {
    this.storeGetters = useStoreGetters();
    this.storeActions = useStore();
    this.bus = window.bus;
    this.route = route;
    this.disconnectTime = null;

    // Filter used for conversations and inbox notifications
    this.filters = filters || {};

    // For conversation folder and filters
    this.hasActiveFilters = false;
    this.hasActiveFolder = false;
    this.activeFilters = null;
    this.activeFolderQuery = null;

    // Store the event handler references
    this.handleOnlineEvent = this.handleOnlineEvent.bind(this);
    this.handleWebSocketReconnect = this.fetchOnReconnect.bind(this);
    this.handleWebSocketDisconnect = this.setDisconnectTime.bind(this);
  }

  static getInstance(route, filters) {
    if (!ReconnectService.instance) {
      ReconnectService.instance = new ReconnectService(route, filters);
    }
    return ReconnectService.instance;
  }

  static resetInstance() {
    if (ReconnectService.instance) {
      ReconnectService.instance.removeEventListeners();
      ReconnectService.instance = null;
    }
  }

  setDisconnectTime() {
    this.disconnectTime = new Date();
  }

  resetDisconnectTime() {
    this.disconnectTime = null;
  }

  isChatListLoading() {
    return this.storeGetters.getChatListLoadingStatus;
  }

  getSecondsSinceDisconnect() {
    return this.disconnectTime
      ? Math.max(differenceInSeconds(new Date(), this.disconnectTime), 0)
      : 0;
  }

  handleOnlineEvent() {
    // if the disconnect time is greater than 3 hours, reload the page
    // if the disconnect time is less than 3 hours, fetch the conversations/notifications
    const seconds = this.getSecondsSinceDisconnect();
    const threshold = 3 * 3600; // 3 hours
    if (seconds >= threshold) {
      // 10800 seconds equals 3 hours
      window.location.reload();
      this.resetDisconnectTime();
    }
  }

  // Fetch conversations on reconnect
  async fetchConversationsOnReconnect() {
    if (this.isChatListLoading()) {
      return;
    }
    try {
      const filters = {
        ...this.filters,
        page: null,
        updatedWithin: this.getSecondsSinceDisconnect(),
      };
      await this.storeActions.dispatch('fetchAllConversations', filters);
    } catch (error) {
      // error
    } finally {
      this.bus.$emit(BUS_EVENTS.WEBSOCKET_RECONNECT_COMPLETED);
    }
  }

  // Fetch filtered or saved conversations on reconnect
  async fetchFilteredOrSavedConversations(payload) {
    try {
      this.storeActions.dispatch('fetchFilteredConversations', {
        queryData: payload,
        page: 1,
      });
    } catch (error) {
      // error
    } finally {
      this.bus.$emit(BUS_EVENTS.WEBSOCKET_RECONNECT_COMPLETED);
    }
  }

  async fetchConversations() {
    if (this.hasActiveFilters || this.hasActiveFolder) {
      await this.fetchFilteredOrSavedConversations(
        this.hasActiveFilters ? this.activeFilters : this.activeFolderQuery
      );
    } else {
      await this.fetchConversationsOnReconnect();
    }
  }

  // Fetch inbox notifications on reconnect
  async fetchInboxNotificationsOnReconnect() {
    try {
      const filter = {
        ...this.filters,
        page: 1,
      };
      this.storeActions.dispatch('notifications/index', filter);
    } catch (error) {
      // error
    } finally {
      this.bus.$emit(BUS_EVENTS.WEBSOCKET_RECONNECT_COMPLETED);
    }
  }

  // Fetch notifications on reconnect
  async fetchNotificationsOnReconnect() {
    try {
      this.storeActions.dispatch('notifications/get', { page: 1 });
    } catch (error) {
      // error
    } finally {
      this.bus.$emit(BUS_EVENTS.WEBSOCKET_RECONNECT_COMPLETED);
    }
  }

  // Revalidate all caches on reconnect
  async revalidateCaches() {
    const cacheKeys = await this.storeActions.dispatch('accounts/getCacheKeys');
    this.storeActions.dispatch('labels/revalidate', {
      newKey: cacheKeys.label,
    });
    this.storeActions.dispatch('inboxes/revalidate', {
      newKey: cacheKeys.inbox,
    });
    this.storeActions.dispatch('teams/revalidate', { newKey: cacheKeys.team });
  }

  // Handle route specific fetch
  async handleRouteSpecificFetch() {
    if (isAConversationRoute(this.route.name, true)) {
      await this.fetchConversations();
    } else if (isAInboxViewRoute(this.route.name, true)) {
      await this.fetchInboxNotificationsOnReconnect();
    } else if (isNotificationRoute(this.route.name)) {
      await this.fetchNotificationsOnReconnect();
    }
  }

  async fetchOnReconnect() {
    // if the disconnect time is greater than 3 hours, reload the page
    // if the disconnect time is less than 3 hours, fetch the conversations/notifications/revalidate caches
    await this.revalidateCaches();
    await this.handleRouteSpecificFetch();
  }

  setupEventListeners() {
    window.addEventListener('online', this.handleOnlineEvent);
    this.bus.$on(BUS_EVENTS.WEBSOCKET_RECONNECT, this.handleWebSocketReconnect);
    this.bus.$on(
      BUS_EVENTS.WEBSOCKET_DISCONNECT,
      this.handleWebSocketDisconnect
    );
  }

  removeEventListeners() {
    window.removeEventListener('online', this.handleOnlineEvent);
    this.bus.$off(
      BUS_EVENTS.WEBSOCKET_RECONNECT,
      this.handleWebSocketReconnect
    );
    this.bus.$off(
      BUS_EVENTS.WEBSOCKET_DISCONNECT,
      this.handleWebSocketDisconnect
    );
  }
}