/*
 * Space Theme - Scroll Controller
 * Handles globe rotation, constellation activation, and navigation
 */

(function() {
    'use strict';

    // DOM Elements
    const constellations = document.querySelectorAll('.constellation');
    const navLinks = document.querySelectorAll('.nav-link');
    const navToggle = document.querySelector('.nav-toggle');
    const navLinksContainer = document.querySelector('.nav-links');
    const root = document.documentElement;

    // State
    let lastScrollY = 0;
    let ticking = false;

    // Initialize
    function init() {
        // Set initial states
        updateOnScroll();

        // Bind events
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', debounce(updateOnScroll, 100));

        // Navigation
        navToggle?.addEventListener('click', toggleMobileNav);
        navLinks.forEach(link => {
            link.addEventListener('click', handleNavClick);
        });

        // Smooth scroll for anchor links
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', handleAnchorClick);
        });

        // Activate first constellation
        setTimeout(() => {
            constellations[0]?.classList.add('active');
        }, 300);
    }

    // Scroll handler with requestAnimationFrame
    function onScroll() {
        lastScrollY = window.scrollY;
        if (!ticking) {
            requestAnimationFrame(() => {
                updateOnScroll();
                ticking = false;
            });
            ticking = true;
        }
    }

    // Main scroll update function
    function updateOnScroll() {
        const scrollY = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const scrollProgress = Math.min(scrollY / docHeight, 1);

        // Calculate surface offset - moves continents left as you scroll
        // The surface is 300% wide (2700px for 900px globe), we want to scroll through ~1800px
        const maxOffset = 1800;
        const surfaceOffset = scrollProgress * maxOffset;

        // Update CSS variables
        root.style.setProperty('--scroll-progress', scrollProgress);
        root.style.setProperty('--surface-offset', surfaceOffset);

        // Update constellations
        updateConstellations();

        // Update navigation
        updateNavigation();
    }

    // Activate constellations based on scroll position
    function updateConstellations() {
        const viewportMiddle = window.innerHeight / 2;

        constellations.forEach((constellation, index) => {
            const rect = constellation.getBoundingClientRect();
            const constellationMiddle = rect.top + rect.height / 2;

            // Check if constellation is in view
            const isInView = rect.top < window.innerHeight * 0.75 && rect.bottom > window.innerHeight * 0.25;

            if (isInView) {
                constellation.classList.add('active');
            } else {
                // Keep first one active if we're at the top
                if (index === 0 && window.scrollY < 100) {
                    constellation.classList.add('active');
                } else {
                    constellation.classList.remove('active');
                }
            }
        });
    }

    // Update active navigation link
    function updateNavigation() {
        let currentSection = '';

        constellations.forEach(constellation => {
            const rect = constellation.getBoundingClientRect();
            if (rect.top <= window.innerHeight / 2 && rect.bottom >= window.innerHeight / 2) {
                currentSection = constellation.id;
            }
        });

        navLinks.forEach(link => {
            const section = link.getAttribute('data-section');
            if (section === currentSection) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });
    }

    // Toggle mobile navigation
    function toggleMobileNav() {
        navLinksContainer?.classList.toggle('active');
        navToggle?.classList.toggle('active');
    }

    // Handle navigation link click
    function handleNavClick(e) {
        // Close mobile nav if open
        navLinksContainer?.classList.remove('active');
        navToggle?.classList.remove('active');
    }

    // Handle anchor link clicks for smooth scroll
    function handleAnchorClick(e) {
        e.preventDefault();
        const targetId = this.getAttribute('href');
        const targetElement = document.querySelector(targetId);

        if (targetElement) {
            const offsetTop = targetElement.offsetTop - 80; // Account for nav height
            window.scrollTo({
                top: offsetTop,
                behavior: 'smooth'
            });
        }
    }

    // Debounce utility
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Parallax effect for stars (optional enhancement)
    function updateStarParallax() {
        const scrollY = window.scrollY;
        const starsSmall = document.querySelector('.stars-small');
        const starsMedium = document.querySelector('.stars-medium');
        const starsLarge = document.querySelector('.stars-large');

        if (starsSmall) starsSmall.style.transform = `translateY(${scrollY * 0.1}px)`;
        if (starsMedium) starsMedium.style.transform = `translateY(${scrollY * 0.2}px)`;
        if (starsLarge) starsLarge.style.transform = `translateY(${scrollY * 0.3}px)`;
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Add parallax to scroll handler (optional - can enable if desired)
    // window.addEventListener('scroll', updateStarParallax, { passive: true });

})();
