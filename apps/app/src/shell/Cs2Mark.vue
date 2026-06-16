<script setup lang="ts">
// CS Demo Analyzer mark: the project icon. The three top shapes do a short,
// subtle "lift" pulse on hover; the lower body stays put. `animate` lets a parent
// (e.g. the home button wrapping icon + title) trigger the same pulse.
withDefaults(defineProps<{ size?: 'sm' | 'md'; animate?: boolean }>(), {
  size: 'sm',
  animate: false,
})
</script>

<template>
  <svg
    viewBox="0 0 403 404"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    class="mark shrink-0"
    :class="[size === 'md' ? 'h-6 w-6' : 'h-5 w-5', { 'is-animating': animate }]"
  >
    <!-- Top-left -->
    <path
      class="top top-a"
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M57.7397 12.9922C57.7417 12.9902 75.5147 30.7642 97.2347 52.4892L135.029 90.292L126.581 91.9892H0.0117188L0.71072 88.2632C6.05272 59.7872 25.5907 32.3772 51.8157 16.5632L57.7397 12.9922Z"
      fill="#FDAC1A"
    />
    <!-- Body + play (stays put) -->
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M0.00396729 215.24C0.00796729 308.513 0.125914 310.931 5.46191 327.277C18.2509 366.454 52.2201 395.265 93.0001 401.522C106.968 403.665 294.901 403.678 309 401.536C356.2 394.369 393.378 357.19 400.545 309.99C401.717 302.276 401.989 284.369 401.994 214.74L402 128.99H0L0.00396729 215.24ZM156.316 171.876C153.735 173.083 151.054 175.463 149.316 178.088L146.5 182.342L146.197 236.415C145.996 272.207 146.25 291.712 146.946 294.105C150.134 305.05 162.757 310.201 173.29 304.853C184.803 299.008 266.747 253.57 268.356 252.139C276.109 245.248 275.519 230.019 267.273 224.203C265.748 223.127 243.375 210.632 217.556 196.435C165.671 167.906 165.209 167.72 156.316 171.876Z"
      fill="#FDAC1A"
    />
    <!-- Top-middle -->
    <path
      class="top top-b"
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M189.984 91.9895H255.984L165 0.989502H99L189.984 91.9895Z"
      fill="#FDAC1A"
    />
    <!-- Top-right -->
    <path
      class="top top-c"
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M266.492 45.5C284.258 63.2689 311.984 91 311.984 91H402.715L402.016 87.274C395.142 50.634 366.033 17.902 329.38 5.598C314.77 0.693997 306.512 0.00800162 261.996 0.00400162L221 0C221 0 248.726 27.7311 266.492 45.5Z"
      fill="#FDAC1A"
    />
  </svg>
</template>

<style scoped>
.top {
  transform: translateY(0);
}

/* Lift on hovering the icon itself or when the parent sets `is-animating`
   (hovering the home button / title). Only the SVG's own `.top` shapes move. */
.mark:hover .top,
.mark.is-animating .top {
  animation: mark-lift 0.5s ease-out;
}

/* Subtle left-to-right stagger */
.mark:hover .top-b,
.mark.is-animating .top-b {
  animation-delay: 0.05s;
}
.mark:hover .top-c,
.mark.is-animating .top-c {
  animation-delay: 0.1s;
}

@keyframes mark-lift {
  0% {
    transform: translateY(0);
  }
  45% {
    transform: translateY(-34px);
  }
  100% {
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .mark:hover .top,
  .mark.is-animating .top {
    animation: none;
  }
}
</style>
